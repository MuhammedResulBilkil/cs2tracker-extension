import { afterEach, describe, expect, it, vi } from 'vitest';
import { CS2TRACKER_ICON_SVG, createIcon } from '../webkit/icon';

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
	 * The mark's arcs share an off-centre origin at (22.62, 22.62) of a 0 0 40 40 box, so the viewBox is
	 * geometry, not packaging: re-cropping it to something centred or square shifts the whole mark. The
	 * path count is pinned here as well as in the asset-vs-source check so a dropped or merged path fails
	 * in CI rather than only when somebody remembers to re-run the command.
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
	 * <parsererror> child into whatever partial root it managed to build -- which is the
	 * querySelector half of the guard. The nodeName half covers the real browser, which makes
	 * <parsererror> the document element instead; that shape is unreachable here, so this test does not
	 * claim to cover it.
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
