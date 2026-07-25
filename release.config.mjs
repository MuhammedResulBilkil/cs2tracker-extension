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
 * points at rather than the one before it. The release workflow runs the same build once up front,
 * before anything is pushed, so a broken build fails the job rather than this publish step.
 */

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
				assets: [{ path: 'cs2tracker-extension-v*.zip', label: 'CS2Tracker Extension (${nextRelease.gitTag})' }],
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
