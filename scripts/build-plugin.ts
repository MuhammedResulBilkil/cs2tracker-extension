/**
 * Packages the built plugin into the zip attached to each GitHub release.
 *
 * The store never uses this zip — its own CI clones the repository at a pinned commit, runs
 * `pnpm install && pnpm run build`, and assembles the distribution itself. This script exists for
 * the other install path: a human downloading the release asset and dropping it into Millennium's
 * plugins folder. It therefore reproduces the shape the store's `prepare-dist.sh` produces:
 *
 *     cs2tracker-extension/          <- one top-level directory, named from plugin.json
 *       .millennium/Dist/…           <- the built frontend and webkit bundles
 *       backend/main.lua             <- the Lua backend, without its editor-only type stubs
 *       plugin.json
 *       metadata.json                <- generated here; carries the plugin id and source commit
 *       README.md
 *       LICENSE.md
 *
 * The single top-level directory is the load-bearing part. Millennium discovers plugins as
 * subdirectories of its plugins folder, so a zip whose members sit at the root would scatter
 * `.millennium`, `backend` and `plugin.json` loose among the user's other plugins.
 *
 * `backend/types` is the one deliberate difference from the store's output — see `EXCLUDED`.
 *
 * Run it with `tsx scripts/build-plugin.ts <version>` after `pnpm run build`, or with
 * `tsx scripts/build-plugin.ts --dry-run` to walk the whole path without leaving an artefact behind.
 */

import { execFileSync } from 'node:child_process';
import type { WriteStream } from 'node:fs';
import { cpSync, createWriteStream, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, relative, sep } from 'node:path';

/**
 * The slice of archiver 8 this script uses.
 *
 * archiver ships no type declarations and `@types/archiver` describes v5's API, so a static import
 * would be an implicit `any`. Going through `createRequire` keeps the untyped module out of the type
 * graph — Node resolves `require()` of an ESM-only package to its namespace object — and lets this
 * declaration stand in for it, which also pins down the one API change that matters: archiver 8
 * removed the callable `archiver('zip', options)` factory that every older example uses in favour of
 * the `ZipArchive` class below.
 */
type ZipStream = {
	pipe(destination: NodeJS.WritableStream): unknown;
	directory(source: string, destination: string | false): unknown;
	on(event: 'error' | 'warning', listener: (error: Error) => void): unknown;
	finalize(): Promise<void>;
	pointer(): number;
};

const require = createRequire(import.meta.url);
const { ZipArchive } = require('archiver') as {
	ZipArchive: new (options?: { zlib?: { level?: number } }) => ZipStream;
};

/** Copied recursively. Absent means the build did not run, which is fatal. */
const REQUIRED = ['.millennium', 'backend', 'plugin.json'] as const;

/** Copied if present. Neither is required to run the plugin, both belong in a downloaded zip. */
const OPTIONAL = ['README.md', 'LICENSE.md'] as const;

/**
 * Paths never copied, relative to the repository root, forward slashes.
 *
 * `backend/types` holds five LuaLS `---@meta` stub files. They exist so an editor can resolve
 * `require("millennium")` and its siblings; Millennium's Lua runtime supplies the real modules, and
 * Lua's `package.path` never looks inside a `types/` subdirectory, so nothing at runtime can read
 * them. Compressed they are about a third of the archive, which is a third of the download for
 * something no user needs. The store copies its backend directory wholesale and so does ship them —
 * that its plugins work regardless is the evidence these files are inert.
 */
const EXCLUDED = new Set(['backend/types']);

/**
 * Files asserted non-empty before anything is staged, mirroring CI's `test -s`. A bundler that exits
 * 0 having written nothing is the failure worth catching: an empty `index.js` packages and installs
 * without complaint and then does nothing.
 */
const NON_EMPTY = ['.millennium/Dist/index.js', '.millennium/Dist/webkit.js', 'backend/main.lua'] as const;

/**
 * Author addresses the store's `get-plugin-id.sh` skips. A repository generated from the Millennium
 * template opens with a bot commit; the plugin's identity is meant to be its first human one.
 */
const TEMPLATE_BOT_EMAILS = new Set([
	'81448108+shdwmtr@users.noreply.github.com',
	'millennium[bot]@noreply.steambrew.app',
]);

const root = process.cwd();
const stageRoot = join(root, 'release');

/** Marks a failure this script asserted, as opposed to an unexpected crash. */
class BuildError extends Error {}

/**
 * Throws rather than calling `process.exit`, so that `main`'s `finally` still runs and a failed build
 * cannot leave its staging directory or a half-written zip behind.
 */
function fail(message: string): never {
	throw new BuildError(message);
}

function git(...args: string[]): string {
	return execFileSync('git', args, { encoding: 'utf8' }).trim();
}

/**
 * The plugin's permanent id: the first commit not authored by the template bot, falling back to the
 * root commit. This reproduces the store's own derivation rather than approximating it, because the
 * install id users type is this value's first twelve characters — it is an identity, not a version,
 * and a drift here would orphan every existing install.
 */
function pluginId(): string {
	// `git log` only reports the history that was actually fetched, so in a shallow clone this would
	// return the oldest commit present rather than the first one ever made — and it would return it
	// without complaint. A wrong id is not a wrong version: it is a different plugin as far as the
	// store and every existing install are concerned. Refuse rather than guess.
	if (git('rev-parse', '--is-shallow-repository') !== 'false') {
		fail('shallow clone: the plugin id comes from the first commit, so fetch the full history first');
	}

	for (const line of git('log', '--format=%H %ae', '--reverse').split('\n')) {
		const [sha, email] = line.trim().split(' ');
		if (!sha || (email !== undefined && TEMPLATE_BOT_EMAILS.has(email))) continue;
		return sha;
	}
	return git('rev-list', '--max-parents=0', 'HEAD');
}

function readJson(file: string): Record<string, unknown> {
	try {
		return JSON.parse(readFileSync(join(root, file), 'utf8')) as Record<string, unknown>;
	} catch (error) {
		fail(`could not read ${file}: ${String(error)}`);
	}
}

/**
 * Fails unless both manifests already carry the version being packaged.
 *
 * `sync-version.ts` runs first in the release, so a mismatch here means either that step was skipped
 * or someone hand-edited one file. Either way the zip would advertise one version in its filename
 * and another in the manifest the store reads, so it is not worth building.
 */
function assertVersion(version: string): void {
	for (const file of ['package.json', 'plugin.json']) {
		const found = readJson(file).version;
		if (found !== version) {
			fail(
				`${file} says version ${JSON.stringify(found)} but this is a build of ${version}\n` +
					`  run \`pnpm exec tsx scripts/sync-version.ts ${version}\` first`,
			);
		}
	}
}

function assertBuilt(): void {
	for (const entry of REQUIRED) {
		if (!existsSync(join(root, entry))) fail(`required entry missing: ${entry} — run \`pnpm run build\` first`);
	}
	for (const entry of NON_EMPTY) {
		const path = join(root, ...entry.split('/'));
		if (!existsSync(path) || statSync(path).size === 0) {
			fail(`${entry} is missing or empty — run \`pnpm run build\` first`);
		}
	}
}

/** The asset globs `release.config.mjs` hands to `@semantic-release/github`, read out of the config. */
function configuredAssetGlobs(): string[] {
	const config = require(join(root, 'release.config.mjs')) as { default?: { plugins?: unknown } };
	const plugins = config.default?.plugins;
	if (!Array.isArray(plugins)) fail('release.config.mjs exports no plugins array');

	for (const entry of plugins) {
		if (!Array.isArray(entry) || entry[0] !== '@semantic-release/github') continue;
		const assets = (entry[1] as { assets?: unknown } | undefined)?.assets;
		if (!Array.isArray(assets)) fail('@semantic-release/github is configured with no assets');
		return assets.map((asset: unknown) =>
			typeof asset === 'string' ? asset : String((asset as { path?: unknown }).path),
		);
	}
	fail('release.config.mjs does not configure @semantic-release/github');
}

/** One glob as a regex. These globs are bare filenames, so only `*` and `?` need translating. */
function globToRegExp(glob: string): RegExp {
	const pattern = glob
		.replace(/[.+^${}()|[\]\\]/g, '\\$&')
		.replace(/\?/g, '[^/]')
		.replace(/\*/g, '[^/]*');
	return new RegExp(`^${pattern}$`);
}

/**
 * Fails unless the filename about to be written is one the release config would actually pick up.
 *
 * This is the assertion that makes the derived filename safe. `@semantic-release/github` does not
 * treat an unmatched glob as an error: it substitutes the glob string itself, fails to stat it, logs
 * that the asset "cannot be read, and will be ignored", and returns — so the release is published
 * with no zip attached and the job exits 0. Turning that into a build failure is the only way to see
 * it. The release workflow runs this script with `--dry-run` before invoking semantic-release, so the
 * failure lands before a tag exists.
 */
function assertGlobbable(zipName: string): void {
	const globs = configuredAssetGlobs();
	if (globs.some((glob) => globToRegExp(glob).test(zipName))) return;
	fail(
		`${zipName} matches none of the asset globs in release.config.mjs (${globs.join(', ')})\n` +
			'  @semantic-release/github would publish a release with no zip attached, and exit 0',
	);
}

/** Copies one root-relative entry into the staging directory, minus anything in `EXCLUDED`. */
function copyInto(entry: string, stageDir: string): void {
	cpSync(join(root, entry), join(stageDir, entry), {
		recursive: true,
		// Refusing a directory skips its whole subtree, which is how `backend/types` is dropped.
		filter: (source) => !EXCLUDED.has(relative(root, source).split(sep).join('/')),
	});
}

/** Lays the distribution out under `release/<name>/`, and returns that directory. */
function stage(name: string): string {
	rmSync(stageRoot, { recursive: true, force: true });
	const stageDir = join(stageRoot, name);
	mkdirSync(stageDir, { recursive: true });

	for (const entry of REQUIRED) copyInto(entry, stageDir);
	for (const entry of OPTIONAL) {
		if (existsSync(join(root, entry))) copyInto(entry, stageDir);
		else console.warn(`build-plugin: optional entry missing, skipping: ${entry}`);
	}

	// Same two keys, same order, as the store writes. `commit` is the revision this zip was built
	// from; `id` is the plugin's permanent identity.
	const metadata = { commit: git('rev-parse', 'HEAD'), id: pluginId() };
	writeFileSync(join(stageDir, 'metadata.json'), `${JSON.stringify(metadata, null, 2)}\n`, 'utf8');
	console.log(`metadata.json: id ${metadata.id}, commit ${metadata.commit}`);

	return stageDir;
}

/** Closes `stream` and waits for the handle to go with it — Windows will not unlink an open file. */
async function closeStream(stream: WriteStream): Promise<void> {
	if (stream.closed) return;
	await new Promise<void>((resolve) => {
		stream.once('close', () => resolve());
		stream.destroy();
	});
}

/** Zips `stageDir` under a single top-level `name/` prefix. Resolves to the archive's size. */
async function archive(stageDir: string, name: string, zipPath: string): Promise<number> {
	rmSync(zipPath, { force: true });
	const zip = new ZipArchive({ zlib: { level: 9 } });
	const output = createWriteStream(zipPath);

	try {
		await new Promise<void>((resolve, reject) => {
			output.on('close', resolve);
			output.on('error', reject);
			zip.on('error', reject);
			// A warning here is a file archiver could not stat or read, which would silently drop an
			// entry from a release artefact. Treat it as fatal.
			zip.on('warning', reject);
			zip.pipe(output);
			zip.directory(stageDir, name);
			void zip.finalize().catch(reject);
		});
	} catch (error) {
		// Whatever reached disk is a truncated zip that the release asset glob would still match, so
		// it has to go before this failure propagates.
		await closeStream(output);
		rmSync(zipPath, { force: true });
		throw error;
	}

	return zip.pointer();
}

async function main(): Promise<void> {
	const argument = process.argv[2];
	if (!argument) fail('usage: tsx scripts/build-plugin.ts <version|--dry-run>');
	const dryRun = argument === '--dry-run';

	const name = readJson('plugin.json').name;
	if (typeof name !== 'string' || name.length === 0) fail('plugin.json has no "name" to package under');

	// A dry run has no next version to package, so it packages the one the manifests already carry.
	// `assertVersion` still runs, so it still catches the two of them disagreeing.
	const version = dryRun ? readJson('package.json').version : argument;
	if (typeof version !== 'string') fail('package.json has no string "version"');

	assertVersion(version);
	assertBuilt();

	const zipName = `${name}-v${version}.zip`;
	assertGlobbable(zipName);

	// A dry run archives inside the staging directory, which is removed either way. It must not be
	// given the release name: a leftover `<name>-v<version>.zip` is matched by the same asset glob and
	// would be uploaded alongside the real one.
	const zipPath = dryRun ? join(stageRoot, 'dry-run.zip') : join(root, zipName);

	try {
		const bytes = await archive(stage(name), name, zipPath);
		if (dryRun) console.log(`dry run: ${zipName} would be ${bytes} bytes, rooted at ${name}/; nothing kept`);
		else console.log(`created ${zipPath} (${bytes} bytes), rooted at ${name}/`);
	} finally {
		rmSync(stageRoot, { recursive: true, force: true });
	}
}

main().catch((error: unknown) => {
	if (error instanceof BuildError) console.error(`build-plugin: ${error.message}`);
	else console.error('build-plugin failed:', error);
	process.exit(1);
});
