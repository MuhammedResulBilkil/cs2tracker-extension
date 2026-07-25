import { beforeEach, describe, expect, it } from 'vitest';
import { STYLE_ELEMENT_ID, ensureStyles, removeStyles } from '../webkit/styles';

beforeEach(() => {
	document.head.innerHTML = '';
});

const cssOf = (doc: Document) => doc.getElementById(STYLE_ELEMENT_ID)?.textContent ?? '';

/**
 * The declarations belonging to one exact selector, so a declaration can be pinned to the rule that
 * owns it instead of to the stylesheet as a whole. Returns '' when that selector has no rule, which
 * fails the assertion that asked for it rather than passing on text found somewhere else.
 */
function ruleBody(css: string, selector: string): string {
	const open = css.indexOf(`${selector}{`);
	return open === -1 ? '' : css.slice(open + selector.length + 1, css.indexOf('}', open));
}

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

	/**
	 * Anchored on the opening brace, one assertion per selector.
	 *
	 * The two bare substring checks this replaces could not tell a rule from a longer selector that
	 * merely starts the same way: '.cs2tracker-btn' is a substring of '.cs2tracker-btn__icon{...}' and
	 * '.cs2tracker-friend-badge' of '.cs2tracker-friend-badge:hover{...}'. Both rules the injectors
	 * actually mount against could therefore have been deleted outright with the suite still green, which
	 * left the CSS half of this module effectively unpinned. Every selector Tasks 7 and 8 consume now has
	 * its own rule and its own assertion.
	 */
	it.each([
		'.cs2tracker-btn{',
		'.cs2tracker-btn:hover{',
		'.cs2tracker-btn:focus-visible{',
		'.cs2tracker-btn__icon{',
		'.cs2tracker-friend-badge{',
		'.cs2tracker-friend-badge:hover{',
		'.cs2tracker-friend-badge svg{',
	])('writes a rule of its own for %s', (rule) => {
		ensureStyles(document);
		expect(cssOf(document)).toContain(rule);
	});

	/**
	 * Pinned as the whole declaration rather than the selector alone, because the value is the point.
	 * Every badge is position:absolute, so this one rule is what makes the friend row the badge's
	 * containing block. Delete it and each badge silently reparents to whatever positioned ancestor is
	 * next up the tree: nothing fails, nothing is visible in CI, and nothing is wrong until somebody
	 * opens Steam. It is the hardest coupling in this module and it had no assertion at all.
	 */
	it('makes the friend row a positioned ancestor for the badge', () => {
		ensureStyles(document);
		expect(cssOf(document)).toContain('.friend_block_v2{position:relative}');
	});

	/**
	 * The button removes the user-agent focus ring, so it owes a replacement: an interactive control with
	 * no visible focus indicator is unusable by keyboard and fails WCAG 2.4.7. Asserted as a pair because
	 * that is the actual contract -- outline:none is only safe while the replacement is there.
	 */
	it('replaces the focus ring it removes', () => {
		ensureStyles(document);
		const css = cssOf(document);
		expect(ruleBody(css, '.cs2tracker-btn')).toContain('outline:none');
		expect(ruleBody(css, '.cs2tracker-btn:focus-visible')).toContain('outline:2px solid #007aef');
		expect(ruleBody(css, '.cs2tracker-btn:focus-visible')).toContain('outline-offset:2px');
	});

	/**
	 * width:100% beside horizontal padding and a border overflows the parent by 26px across under
	 * content-box, and this rule declares all three. Pinned to the rule body so the declaration cannot
	 * drift into some other selector, and pinned at all because the alternative is depending on Steam
	 * shipping a global border-box reset that nothing here can see.
	 */
	it('sizes the button in border-box so width:100% cannot overflow', () => {
		ensureStyles(document);
		const button = ruleBody(cssOf(document), '.cs2tracker-btn');
		expect(button).toContain('box-sizing:border-box');
		expect(button).toContain('width:100%');
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

	/**
	 * The mirror of ensureStyles' two-document test, and it was missing. Both cases above operate on the
	 * ambient document, so swapping this function's doc.getElementById for the ambient
	 * document.getElementById survived the entire suite -- the same mutation in ensureStyles is killed.
	 * Teardown would then have stripped the wrong page's stylesheet and left the requested one in place.
	 */
	it('removes from the document it is given and leaves the others alone', () => {
		const other = document.implementation.createHTMLDocument('other');
		ensureStyles(document);
		ensureStyles(other);
		removeStyles(other);
		expect(other.getElementById(STYLE_ELEMENT_ID)).toBeNull();
		expect(document.getElementById(STYLE_ELEMENT_ID)).not.toBeNull();
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
