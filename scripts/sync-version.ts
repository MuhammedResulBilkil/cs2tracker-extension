/**
 * Keeps `package.json` and `plugin.json` on one version, and asserts that they are.
 *
 * Two files carry the plugin's version and nothing in the build forces them to match:
 * `package.json` is what npm-shaped tooling reads, `plugin.json` is what Millennium and the store
 * read and what users see in the plugin list. `semantic-release` calls this script from its prepare
 * step so a release writes both at once.
 *
 * Two modes:
 *
 *   tsx scripts/sync-version.ts 1.2.3   write that version to both files
 *   tsx scripts/sync-version.ts --check  assert the two already agree, writing nothing
 *
 * The `--check` mode runs in CI, because the failure this guards against is a hand-edit to one file
 * that never reaches the other. That drift is silent — the plugin builds and loads fine, and the
 * wrong number only surfaces in the store listing.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** The version-bearing files, each with the indentation it is written back with. */
const FILES = [
	['package.json', '\t'],
	['plugin.json', '\t'],
] as const;

/**
 * Plain semver, no `v` prefix. `semantic-release` hands over exactly this, so anything else is a
 * mistake worth stopping on — most plausibly an uninterpolated `${nextRelease.version}` escaping
 * `release.config.mjs`, which would otherwise be written verbatim into the manifest the store reads.
 */
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

const root = process.cwd();

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
 * Reads both files and fails unless they carry one well-formed version. Returns it.
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
	return expected;
}

const argument = process.argv[2];
if (!argument) fail('usage: tsx scripts/sync-version.ts <version|--check>');

if (argument === '--check') {
	console.log(`package.json and plugin.json agree on ${assertAgreement()}`);
} else {
	if (!SEMVER.test(argument)) fail(`refusing to write a version that is not plain semver: ${JSON.stringify(argument)}`);

	for (const [file, indent] of FILES) {
		const parsed = load(file);
		parsed.version = argument;
		writeFileSync(join(root, file), `${JSON.stringify(parsed, null, indent)}\n`, 'utf8');
		console.log(`updated ${file} to ${argument}`);
	}

	const written = assertAgreement();
	if (written !== argument) fail(`asked for ${argument} but the files now read ${written}`);
	console.log(`package.json and plugin.json agree on ${written}`);
}
