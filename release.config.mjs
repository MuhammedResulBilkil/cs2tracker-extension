/**
 * `semantic-release` configuration, driven by `.github/workflows/release.yml`.
 *
 * `branches` is the only guard that decides where a release may come from, and it is deliberately a
 * single entry. Run on any other ref — a feature branch, a `workflow_dispatch` from a fork — and
 * semantic-release refuses before it analyses a single commit. The workflow narrows the same thing a
 * second time so that neither layer is the only thing standing between a push and a tag.
 *
 * Plugin order is execution order within each lifecycle step, which is what makes this sequence
 * work:
 *
 *   prepare  changelog writes CHANGELOG.md → exec syncs both manifests to the new version →
 *            git commits those three files and pushes
 *   (tag)    semantic-release tags the release commit
 *   publish  exec builds the bundles and the zip → github creates the release and uploads it
 *
 * The zip is built after the tag exists, so its `metadata.json` records the commit the tag actually
 * points at rather than the one before it. The release workflow runs the same build, and a packaging
 * smoke test, once up front before anything is pushed, so a failure there fails the job instead of
 * this publish step.
 */

import { readFileSync } from 'node:fs';

/**
 * Read from the same manifest `build-plugin.ts` names its output from, resolved against this file
 * rather than the working directory.
 *
 * The asset glob below has to match the filename that script writes, and a mismatch fails silently
 * rather than loudly: `@semantic-release/github` treats a glob that matches nothing as an unreadable
 * asset, logs it, and carries on — so the release is created, the job exits 0, and the zip is simply
 * absent. Deriving both sides from one value is what prevents that. `build-plugin.ts` then reads this
 * glob back out and asserts its output matches, so a later edit that hardcodes either side fails the
 * build rather than publishing an empty release.
 */
const { name } = JSON.parse(readFileSync(new URL('./plugin.json', import.meta.url), 'utf8'));

export default {
	branches: ['master'],
	plugins: [
		'@semantic-release/commit-analyzer',
		'@semantic-release/release-notes-generator',
		['@semantic-release/changelog', { changelogFile: 'CHANGELOG.md' }],
		[
			'@semantic-release/exec',
			{
				prepareCmd: 'pnpm exec tsx scripts/sync-version.ts ${nextRelease.version}',
				publishCmd: 'pnpm run build && pnpm exec tsx scripts/build-plugin.ts ${nextRelease.version}',
			},
		],
		[
			'@semantic-release/github',
			{
				// `path` interpolates here and now, from plugin.json. `label` must not — those braces are
				// a semantic-release template, so it stays a plain single-quoted string.
				assets: [{ path: `${name}-v*.zip`, label: 'CS2Tracker Extension (${nextRelease.gitTag})' }],
			},
		],
		[
			'@semantic-release/git',
			{
				assets: ['package.json', 'plugin.json', 'CHANGELOG.md'],
				// `[skip ci]` is not cosmetic: this commit is a push to master, which is exactly what
				// triggers the release workflow. Without it the workflow would release its own release
				// commit, and keep doing so.
				message: 'chore(release): ${nextRelease.version} [skip ci]\n\n${nextRelease.notes}',
			},
		],
	],
};
