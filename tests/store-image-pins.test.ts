import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { PINNED_IMAGE_FIELDS, refForVersion, refOfAssetUrl, repinAssetUrl } from '../scripts/sync-version';

/**
 * The store fetches `thumbnail` and `splash_image` when someone opens the listing, not when the
 * plugin is reviewed or installed. Millennium's schema requires an absolute URL for both, so the
 * submodule pin in the plugin database does not cover them: left on a branch ref, the image a
 * reviewer approved and the image a user is shown are free to differ forever after.
 *
 * `scripts/sync-version.ts` re-pins both to the release tag during `semantic-release`'s prepare
 * step. This suite holds the two halves of that: the manifest on disk is pinned right now, and the
 * rewrite that keeps it pinned behaves.
 */
// fileURLToPath is given a string, not a URL object: the happy-dom test environment replaces the
// global URL constructor, and Node rejects the resulting foreign instance.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const manifest = JSON.parse(readFileSync(join(ROOT, 'plugin.json'), 'utf8')) as Record<string, string>;

/** Refs that move. A pin to any of these is not a pin. */
const MUTABLE_REFS = ['master', 'main', 'HEAD', 'latest', 'dev'];

describe('plugin.json store images', () => {
	it('pins every store image to the current version', () => {
		const want = refForVersion(manifest.version);
		for (const field of PINNED_IMAGE_FIELDS) {
			expect(refOfAssetUrl(manifest[field]), `${field} should be pinned to ${want}`).toBe(want);
		}
	});

	it('leaves no store image on a ref that can move', () => {
		for (const field of PINNED_IMAGE_FIELDS) {
			expect(MUTABLE_REFS).not.toContain(refOfAssetUrl(manifest[field]));
		}
	});

	/**
	 * `$schema` is also a raw.githubusercontent.com URL and is deliberately *not* pinned — it tracks
	 * Millennium's `main` so the editor hints follow the schema as it changes. It is excluded by
	 * living outside PINNED_IMAGE_FIELDS rather than by anything in the URL, so the exclusion is
	 * worth asserting: widening that list to "every raw URL in the manifest" would silently freeze
	 * the schema reference too.
	 */
	it('does not pin $schema, which is meant to track Millennium main', () => {
		expect(PINNED_IMAGE_FIELDS).not.toContain('$schema');
		expect(refOfAssetUrl(manifest.$schema)).toBe('main');
	});
});

describe('repinAssetUrl', () => {
	const base = 'https://raw.githubusercontent.com/MuhammedResulBilkil/cs2tracker-extension';

	it('moves a branch ref onto the release tag', () => {
		expect(repinAssetUrl(`${base}/master/assets/thumbnail.png`, '1.2.3')).toBe(`${base}/v1.2.3/assets/thumbnail.png`);
	});

	it('moves an already-pinned tag onto the new one, so releases re-pin rather than stick', () => {
		expect(repinAssetUrl(`${base}/v1.0.0/assets/splash.png`, '1.0.1')).toBe(`${base}/v1.0.1/assets/splash.png`);
	});

	it('rewrites only the ref, leaving owner, repo and nested path intact', () => {
		const forked = 'https://raw.githubusercontent.com/someone-else/their-fork/master/assets/deep/nested.png';
		expect(repinAssetUrl(forked, '2.0.0')).toBe(
			'https://raw.githubusercontent.com/someone-else/their-fork/v2.0.0/assets/deep/nested.png',
		);
	});

	/**
	 * The schema names Imgur as an acceptable host, so a URL this cannot parse is plausible rather
	 * than absurd — and it is exactly the case where returning the input unchanged would leave a
	 * mutable image in a released manifest while reporting success.
	 */
	it('throws rather than silently passing through a URL it cannot pin', () => {
		expect(() => repinAssetUrl('https://i.imgur.com/abc123.png', '1.0.0')).toThrow(/not a raw\.githubusercontent\.com/);
	});

	it('throws on a raw URL with no path after the ref', () => {
		expect(() => repinAssetUrl(`${base}/master`, '1.0.0')).toThrow();
	});
});

describe('refOfAssetUrl', () => {
	it('returns null for a URL that is not a raw.githubusercontent.com asset', () => {
		expect(refOfAssetUrl('https://i.imgur.com/abc123.png')).toBeNull();
		expect(refOfAssetUrl('https://github.com/owner/repo/blob/main/a.png')).toBeNull();
	});
});

describe('refForVersion', () => {
	it('is the tag semantic-release creates, so the pin and the tag cannot drift', () => {
		expect(refForVersion('1.0.0')).toBe('v1.0.0');
		expect(refForVersion('2.3.4-beta.1')).toBe('v2.3.4-beta.1');
	});
});
