/**
 * Id of the injected <style> element. Also the idempotency key: presence of this id in a document is
 * what tells ensureStyles the document is already styled, so it has to be unique enough not to collide
 * with anything Steam ships.
 */
export const STYLE_ELEMENT_ID = 'cs2tracker-extension-style';

/**
 * Both injection points, in one stylesheet.
 *
 * .cs2tracker-btn, its states and .cs2tracker-btn__icon dress the profile button (Task 7);
 * .friend_block_v2 and .cs2tracker-friend-badge dress the friend row badges (Task 8).
 *
 * box-sizing:border-box is load-bearing next to width:100%. The rule also declares horizontal padding
 * and a 1px border, so under content-box the button overflows its parent by 26px across and 2px down.
 * It would lay out correctly only if Steam happened to apply border-box globally, and relying on
 * somebody else's reset for your own layout is a coincidence rather than a decision.
 *
 * :focus-visible is what makes outline:none legitimate. The button is an interactive control, and
 * removing the user-agent focus ring without replacing it leaves keyboard users with no indication of
 * where they are -- WCAG 2.4.7. The replacement reuses the hover accent so the two states read as one
 * design, and outline-offset keeps the ring clear of the border.
 *
 * .friend_block_v2 is Steam's own class, and touching it has a real cost that runs in both directions.
 * Forwards: every badge is position:absolute, so the row has to be a positioned ancestor or the badge
 * escapes to whatever positioned element is next up the tree. Backwards, and this is the part worth
 * checking against a live client: position:relative is *not* visually inert. It makes the row the
 * containing block for any absolutely-positioned descendant Steam already has in there -- its row-wide
 * link overlay and status markers, among others -- so any of those currently resolving against an
 * ancestor further out silently re-anchor to the row. The declaration is still the narrowest hook
 * available, but it is a change to Steam's layout, not a no-op. Related: a positioned box with
 * z-index:auto starts no stacking context, so the badge's z-index competes with Steam's overlay in
 * whichever context encloses them both.
 *
 * text-decoration:none is declared twice on purpose. Nothing here can see Steam's stylesheet, so the
 * base declaration wins on source order against an equally specific Steam rule and loses to a more
 * specific one; hover is where Steam most reliably puts an underline back, so that one declaration
 * shouts and the rest do not. If a live check finds Steam's base anchor rule is itself !important, then
 * the base declaration here is dead and the !important belongs on both -- unresolvable offline, so it
 * is stated rather than assumed.
 */
const CSS = [
	// Deliberately matched to the CSStats.gg button, which sits directly above this one on any profile
	// where both plugins are installed -- same 3rem height, same #1a1a1a ground, same #2d3748 hover, and
	// the same 20px/800 uppercase wordmark with one word carrying the brand colour.
	//
	// What is NOT copied is their `@import url(fonts.googleapis.com/...)` for the Cairo typeface. That
	// would make every community page fetch a font from Google and put the reader's IP in Google's logs,
	// which is a network request this plugin does not otherwise make and which the README's Privacy
	// section says does not happen. The system stack below loses the -11deg slant that Cairo's `slnt`
	// axis provides and nothing else.
	'.cs2tracker-btn{display:flex;box-sizing:border-box;width:100%;height:3rem;align-items:center;justify-content:center;gap:10px;margin:10px 0;padding:0 12px;font-size:20px;font-weight:800;letter-spacing:.01em;text-transform:uppercase;color:#fff;background-color:#1a1a1a;border:none;border-radius:5px;cursor:pointer;text-decoration:none;outline:none;transition:background-color .5s cubic-bezier(.23,1,.32,1)}',
	'.cs2tracker-btn:hover{background-color:#2d3748;text-decoration:none!important}',
	'.cs2tracker-btn:focus-visible{outline:2px solid #007aef;outline-offset:2px}',
	// The accent word. Its own transition rather than `all`, so the colour shift on hover cannot drag
	// layout properties along with it.
	'.cs2tracker-btn__accent{display:inline-block;color:#007aef;transition:color .5s cubic-bezier(.23,1,.32,1)}',
	'.cs2tracker-btn:hover .cs2tracker-btn__accent{color:#2aa6ff}',
	'.cs2tracker-btn__icon{height:22px;width:22px;flex:0 0 auto}',
	'.friend_block_v2{position:relative}',
	'.cs2tracker-friend-badge{position:absolute;top:6px;right:6px;z-index:5;display:flex;height:22px;width:22px;align-items:center;justify-content:center;border-radius:4px;background-color:rgba(12,16,23,.85);opacity:.75;transition:opacity .15s ease}',
	'.cs2tracker-friend-badge:hover{opacity:1}',
	'.cs2tracker-friend-badge svg{height:16px;width:16px}',
].join('');

/**
 * Inject the stylesheet once per document.
 *
 * Per document, not per module load: the community browser runs this bundle against every community
 * page it opens, and each of those pages is a separate document with its own head. A module-level
 * "already injected" flag would look idempotent and leave every page after the first unstyled, so the
 * check reads the target document instead.
 */
export function ensureStyles(doc: Document): void {
	if (doc.getElementById(STYLE_ELEMENT_ID)) return;
	const style = doc.createElement('style');
	style.id = STYLE_ELEMENT_ID;
	style.textContent = CSS;
	(doc.head ?? doc.documentElement).appendChild(style);
}

/** Undo ensureStyles. Safe on a document that was never styled, and leaves it ready to be styled again. */
export function removeStyles(doc: Document): void {
	doc.getElementById(STYLE_ELEMENT_ID)?.remove();
}
