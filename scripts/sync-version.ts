/**
 * Keeps `package.json` and `plugin.json` on one version, keeps the store's images pinned to that
 * version, and asserts that both hold.
 *
 * Two files carry the plugin's version and nothing in the build forces them to match:
 * `package.json` is what npm-shaped tooling reads, `plugin.json` is what Millennium and the store
 * read and what users see in the plugin list. `semantic-release` calls this script from its prepare
 * step so a release writes both at once.
 *
 * The same step re-pins `thumbnail` and `splash_image`. Millennium's schema requires an absolute
 * URL for both, so a submodule pin in the plugin database does not cover them: the store fetches
 * whatever those URLs resolve to at the moment someone opens the listing. Left on a branch ref they
 * stay mutable after review, which means the images a reviewer approved need not be the images a
 * user is shown. Rewriting them here — in the same prepare step, from the same version — is what
 * makes the reviewed asset and the displayed asset the same file, without adding a release step
 * anyone has to remember.
 *
 * The rewrite is safe against the chicken-and-egg it looks like it has. `@semantic-release/git`
 * commits `plugin.json` during prepare and semantic-release tags *that* commit, so the tag named by
 * these URLs is the tag they are committed under, and `assets/` exists there.
 *
 * Two modes:
 *
 *   tsx scripts/sync-version.ts 1.2.3   write that version to both files and re-pin the images
 *   tsx scripts/sync-version.ts --check  assert the files already agree, writing nothing
 *
 * The `--check` mode runs in CI, because the failures this guards against are silent: a hand-edit
 * to one file that never reaches the other, or an image URL nudged back onto a branch ref. Both
 * build and load fine, and only surface in the store listing.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The version-bearing files, each with the indentation it is written back with. */
const FILES = [
	['package.json', '\t'],
	['plugin.json', '\t'],
] as const;

/** The `plugin.json` fields the store renders as images, and therefore fetches at display time. */
export const PINNED_IMAGE_FIELDS = ['thumbnail', 'splash_image'] as const;

/**
 * `https://raw.githubusercontent.com/<owner>/<repo>/<ref>/<path>`, split so the ref can be replaced
 * without touching either side of it.
 *
 * Owner and repo are matched rather than hardcoded, so a fork re-pins to its own tags instead of
 * silently serving this repository's images. The pattern is only ever applied to
 * `PINNED_IMAGE_FIELDS`, which is what keeps it away from `$schema` — also a
 * raw.githubusercontent.com URL, and one that is *meant* to track Millennium's `main`.
 */
const RAW_ASSET_URL = /^(https:\/\/raw\.githubusercontent\.com\/[^/]+\/[^/]+\/)([^/]+)(\/.+)$/;

/**
 * Plain semver, no `v` prefix. `semantic-release` hands over exactly this, so anything else is a
 * mistake worth stopping on — most plausibly an uninterpolated `${nextRelease.version}` escaping
 * `release.config.mjs`, which would otherwise be written verbatim into the manifest the store reads.
 */
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

const root = process.cwd();

/** The git ref a release of `version` is tagged as, and therefore the ref its images pin to. */
export function refForVersion(version: string): string {
	return `v${version}`;
}

/** The ref segment of a raw.githubusercontent.com URL, or `null` if it is not one. */
export function refOfAssetUrl(url: string): string | null {
	return RAW_ASSET_URL.exec(url)?.[2] ?? null;
}

/**
 * The same URL with its ref segment replaced by `version`'s tag. Throws rather than returning the
 * input unchanged: a URL this cannot parse is one the release would otherwise leave mutable, and
 * silently doing nothing is the failure this whole mechanism exists to prevent.
 */
export function repinAssetUrl(url: string, version: string): string {
	const parts = RAW_ASSET_URL.exec(url);
	if (!parts) throw new Error(`not a raw.githubusercontent.com asset URL: ${JSON.stringify(url)}`);
	return `${parts[1]}${refForVersion(version)}${parts[3]}`;
}

function fail(message: string): never {
	console.error(`sync-version: ${message}`);
	process.exit(1);
}

function load(file: string): Record<string, unknown> {
	try {
		return JSON.parse(readFileSync(join(root, file), 'utf8')) as Record<string, unknown>;
	} catch (error) {
		fail(`could not read ${file}: ${String(error)}`);
	}
}

/**
 * Reads both files and fails unless they carry one well-formed version and the store images are
 * pinned to it. Returns the version.
 *
 * Deliberately re-reads from disk rather than trusting what was just written: the point of the
 * check is the state of the working tree, not the intent of this process.
 */
function assertAgreement(): string {
	const found = FILES.map(([file]) => {
		const value = load(file).version;
		if (typeof value !== 'string') fail(`${file} has no string "version" field`);
		if (!SEMVER.test(value)) fail(`${file} has a version that is not plain semver: ${JSON.stringify(value)}`);
		return [file, value] as const;
	});

	const [[, expected]] = found;
	if (found.some(([, value]) => value !== expected)) {
		fail(
			'package.json and plugin.json disagree on version:\n' +
				found.map(([file, value]) => `  ${file}: ${value}`).join('\n') +
				'\nrun `pnpm exec tsx scripts/sync-version.ts <version>` to bring them back in line',
		);
	}

	const manifest = load('plugin.json');
	const want = refForVersion(expected);
	for (const field of PINNED_IMAGE_FIELDS) {
		const url = manifest[field];
		if (typeof url !== 'string') fail(`plugin.json has no string "${field}" field`);

		const ref = refOfAssetUrl(url);
		if (ref === null) fail(`plugin.json "${field}" is not a raw.githubusercontent.com URL: ${JSON.stringify(url)}`);
		if (ref !== want) {
			fail(
				`plugin.json "${field}" is pinned to ${JSON.stringify(ref)}, not ${JSON.stringify(want)}:\n` +
					`  ${url}\n` +
					'the store fetches this URL when the listing is opened, so a branch ref lets the image\n' +
					'change after review — run `pnpm exec tsx scripts/sync-version.ts <version>` to re-pin it',
			);
		}
	}

	return expected;
}

function main(): void {
	const argument = process.argv[2];
	if (!argument) fail('usage: tsx scripts/sync-version.ts <version|--check>');

	if (argument === '--check') {
		const version = assertAgreement();
		console.log(`package.json and plugin.json agree on ${version}, images pinned to ${refForVersion(version)}`);
		return;
	}

	if (!SEMVER.test(argument)) fail(`refusing to write a version that is not plain semver: ${JSON.stringify(argument)}`);

	for (const [file, indent] of FILES) {
		const parsed = load(file);
		parsed.version = argument;

		if (file === 'plugin.json') {
			for (const field of PINNED_IMAGE_FIELDS) {
				const url = parsed[field];
				if (typeof url !== 'string') fail(`plugin.json has no string "${field}" field`);
				try {
					parsed[field] = repinAssetUrl(url, argument);
				} catch (error) {
					fail(String(error instanceof Error ? error.message : error));
				}
			}
		}

		writeFileSync(join(root, file), `${JSON.stringify(parsed, null, indent)}\n`, 'utf8');
		console.log(`updated ${file} to ${argument}`);
	}

	const written = assertAgreement();
	if (written !== argument) fail(`asked for ${argument} but the files now read ${written}`);
	console.log(`package.json and plugin.json agree on ${written}, images pinned to ${refForVersion(written)}`);
}

// Only run the CLI when this file is the entrypoint, so the helpers above stay importable by tests.
const entrypoint = process.argv[1];
if (entrypoint !== undefined && resolve(entrypoint) === fileURLToPath(import.meta.url)) main();
