import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CS2TRACKER_ICON_SVG, createIcon } from '../webkit/icon';

/**
 * webkit/icon.ts inlines assets/icon.svg as a string constant, because the webkit bundle has no loader and
 * no fetch it could use to read a file. So the mark exists twice, and the copy can drift from its source in
 * silence -- a mistyped coordinate, a dropped path, a re-cropped viewBox all still render something
 * icon-shaped.
 *
 * That drift had a specific shape worth naming. tests/frontend-icon.test.ts pins the frontend's
 * transcription against this same asset, so a future `pnpm run trace-icon` that regenerates it fails that
 * suite loudly -- while this constant, checked only for a path count and a viewBox, would have kept the old
 * mark without a word. The two mount points would then draw different marks: the settings panel the new
 * one, every injected button and badge the old one.
 *
 * fileURLToPath is given a string, not a URL object: the happy-dom test environment replaces the global URL
 * constructor, and Node rejects the resulting foreign instance. Same reason as the frontend suite.
 */
const ASSET_PATH = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'icon.svg');
const ASSET = readFileSync(ASSET_PATH, 'utf8');

/**
 * The documented conversion, applied here so the test performs it rather than restating its result: the
 * constant is exactly the asset with the newline between each element removed, and nothing else.
 *
 * Line endings are normalised first. `.gitattributes` checks this repository out with LF, so the replace
 * below is all that is needed today -- but a checkout that ignored it would otherwise fail this test for
 * the wrong reason, reporting a drifted mark when the only difference is a carriage return.
 */
const FLATTENED_ASSET = ASSET.replace(/\r\n/g, '\n').replace(/\n/g, '');

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('CS2TRACKER_ICON_SVG', () => {
	it('is a real vector with no embedded raster', () => {
		expect(CS2TRACKER_ICON_SVG).toContain('<path');
		expect(CS2TRACKER_ICON_SVG).not.toContain('base64');
		expect(CS2TRACKER_ICON_SVG).not.toContain('<image');
	});

	/**
	 * The whole constant against the whole asset, in one assertion: every coordinate, every fill, the
	 * viewBox, the element order and the namespace declaration. This is the check that makes a regenerated
	 * asset fail here as loudly as it already fails tests/frontend-icon.test.ts, instead of leaving this
	 * copy silently stale.
	 *
	 * It also documents the conversion by performing it. If the flattening rule ever stops being "delete
	 * the newlines" -- a formatter wrapping the path data, say -- this fails and the docblock on the
	 * constant has to be rewritten with it, which is the correct outcome rather than a nuisance.
	 */
	it('is the asset, flattened, byte for byte', () => {
		expect(CS2TRACKER_ICON_SVG).toBe(FLATTENED_ASSET);
	});

	// Guards the comparison above rather than the mark: if the asset were ever emptied or truncated to
	// something with no shapes in it, `toBe` would still pass against an equally empty constant.
	it('compares against an asset that actually holds the mark', () => {
		expect(ASSET).toContain('<svg');
		expect(ASSET).toContain('</svg>');
		expect(ASSET.match(/<path/g)).toHaveLength(5);
	});

	/**
	 * The mark's arcs share an off-centre origin at (22.62, 22.62) of a 0 0 40 40 box, so the viewBox is
	 * geometry, not packaging: re-cropping it to something centred or square shifts the whole mark.
	 *
	 * Kept alongside the byte comparison above rather than folded into it, because the two fail with
	 * different messages and one of them is a diagnosis. A regenerated asset fails `toBe` with a diff of two
	 * 700-character strings; a dropped path or an edited viewBox fails here, naming which of the two it was.
	 */
	it('keeps the traced geometry: the off-centre viewBox and all five paths', () => {
		expect(CS2TRACKER_ICON_SVG).toContain('viewBox="0 0 40 40"');
		expect(CS2TRACKER_ICON_SVG.match(/<path/g)).toHaveLength(5);
	});
});

describe('createIcon', () => {
	it('returns an svg element owned by the target document', () => {
		const icon = createIcon(document, 'cs2tracker-btn__icon');
		expect(icon).not.toBeNull();
		expect(icon!.tagName.toLowerCase()).toBe('svg');
		expect(icon!.ownerDocument).toBe(document);
	});

	it('applies the class and hides itself from assistive tech', () => {
		const icon = createIcon(document, 'my-class')!;
		expect(icon.getAttribute('class')).toBe('my-class');
		expect(icon.getAttribute('aria-hidden')).toBe('true');
	});

	it('returns a fresh node on every call', () => {
		expect(createIcon(document, 'a')).not.toBe(createIcon(document, 'a'));
	});

	// Delete the constant's xmlns and the parse still succeeds, the root is still named svg, the paths
	// are still there, and every other assertion in this file still passes -- the elements just land in
	// no namespace and the browser draws nothing. This is the only check that separates an icon that
	// renders from one that silently does not.
	it('puts the icon in the SVG namespace so it actually renders', () => {
		const icon = createIcon(document, 'x')!;
		expect(icon.namespaceURI).toBe('http://www.w3.org/2000/svg');
		expect(icon.querySelector('path')!.namespaceURI).toBe('http://www.w3.org/2000/svg');
	});

	// Two injection points mount this icon, and the profile button mounts it into a document the badge
	// scanner also touches. A shared node would silently move between mount points instead of appearing
	// at both, so independence has to hold for the subtree too, not just the root element.
	it('gives each call its own subtree, not a shared one', () => {
		const first = createIcon(document, 'a')!;
		const second = createIcon(document, 'b')!;
		expect(first.querySelector('path')).not.toBe(second.querySelector('path'));
		expect(first.querySelectorAll('path')).toHaveLength(5);
		expect(second.getAttribute('class')).toBe('b');
		expect(first.getAttribute('class')).toBe('a');
	});

	// Serves a different document than the one the module was loaded against: Steam's community browser
	// hands the webkit bundle whichever document the page is, and a node built against the wrong
	// document throws WrongDocumentError on insert in a real browser.
	it('builds against a document other than the ambient one', () => {
		const other = document.implementation.createHTMLDocument('other');
		const icon = createIcon(other, 'x')!;
		expect(icon.ownerDocument).toBe(other);
		expect(() => other.body.appendChild(icon)).not.toThrow();
	});

	/**
	 * The markup is a static constant, so the guard is only reachable by replacing the parser. happy-dom
	 * is faithful enough for that to mean something: on malformed XML it does not throw, it injects a
	 * <parsererror> child into whatever partial root it managed to build. That is Blink's shape, and Blink
	 * is what Steam's embedded browser runs, so the querySelector half of the guard is covered here and in
	 * production by the same behaviour. The nodeName half is for Gecko, which makes <parsererror> the
	 * document element instead; that shape is unreachable here, so this test does not claim to cover it.
	 */
	it('returns null rather than an error box when parsing fails', () => {
		const broken = new DOMParser().parseFromString('<svg><path d="M0 0"></svg>', 'image/svg+xml');
		expect(broken.documentElement.querySelector('parsererror')).not.toBeNull();

		vi.stubGlobal(
			'DOMParser',
			class {
				parseFromString() {
					return broken;
				}
			},
		);
		expect(createIcon(document, 'x')).toBeNull();
	});
});
