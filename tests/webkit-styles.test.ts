import { beforeEach, describe, expect, it } from 'vitest';
import { STYLE_ELEMENT_ID, ensureStyles, removeStyles } from '../webkit/styles';

beforeEach(() => {
	document.head.innerHTML = '';
});

describe('ensureStyles', () => {
	it('adds a single style element', () => {
		ensureStyles(document);
		expect(document.querySelectorAll(`#${STYLE_ELEMENT_ID}`)).toHaveLength(1);
	});

	it('is idempotent', () => {
		ensureStyles(document);
		ensureStyles(document);
		ensureStyles(document);
		expect(document.querySelectorAll(`#${STYLE_ELEMENT_ID}`)).toHaveLength(1);
	});

	it('writes CSS for both injection points', () => {
		ensureStyles(document);
		const css = document.getElementById(STYLE_ELEMENT_ID)!.textContent ?? '';
		expect(css).toContain('.cs2tracker-btn');
		expect(css).toContain('.cs2tracker-friend-badge');
	});

	/**
	 * "Once" has to mean once per document, not once per module load. The community browser runs this
	 * bundle against every community page it opens, so a module-level "already injected" flag would pass
	 * every assertion above and then leave the second page unstyled. Asserting on both documents in one
	 * test is what makes the flag impossible: a per-document check satisfies both, a shared flag cannot.
	 */
	it('injects into each document it is given', () => {
		const other = document.implementation.createHTMLDocument('other');
		ensureStyles(document);
		ensureStyles(other);
		expect(document.querySelectorAll(`#${STYLE_ELEMENT_ID}`)).toHaveLength(1);
		expect(other.querySelectorAll(`#${STYLE_ELEMENT_ID}`)).toHaveLength(1);
	});
});

describe('removeStyles', () => {
	it('removes the style element', () => {
		ensureStyles(document);
		removeStyles(document);
		expect(document.getElementById(STYLE_ELEMENT_ID)).toBeNull();
	});

	it('is safe when nothing was injected', () => {
		expect(() => removeStyles(document)).not.toThrow();
	});

	// Teardown then re-inject is the plugin's own enable/disable cycle, so the pair has to be able to
	// run more than once. A remove that left the id behind, or an ensure that refused after a remove,
	// would show up as a dead second injection.
	it('leaves the document ready for a later injection', () => {
		ensureStyles(document);
		removeStyles(document);
		ensureStyles(document);
		expect(document.querySelectorAll(`#${STYLE_ELEMENT_ID}`)).toHaveLength(1);
	});
});
