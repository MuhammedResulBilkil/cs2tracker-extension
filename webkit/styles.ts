/**
 * Id of the injected <style> element. Also the idempotency key: presence of this id in a document is
 * what tells ensureStyles the document is already styled, so it has to be unique enough not to collide
 * with anything Steam ships.
 */
export const STYLE_ELEMENT_ID = 'cs2tracker-extension-style';

/**
 * Both injection points, in one stylesheet.
 *
 * .cs2tracker-btn and .cs2tracker-btn__icon dress the profile button (Task 7); .friend_block_v2 and
 * .cs2tracker-friend-badge dress the friend row badges (Task 8). .friend_block_v2 is Steam's own class
 * and is touched for one reason: the badge is absolutely positioned, so the row it sits in has to be a
 * positioned ancestor or the badge escapes to the nearest one that is. Setting position on somebody
 * else's element is a real cost, but position:relative on a block that is already laid out changes
 * nothing visually and is the narrowest hook available.
 *
 * text-decoration:none!important on hover overrides Steam's anchor rules, which are themselves
 * !important; nothing else here needs to shout.
 */
const CSS = [
	'.cs2tracker-btn{display:flex;width:100%;height:3rem;align-items:center;justify-content:center;gap:8px;margin:10px 0;padding:0 12px;color:#fff;font-weight:700;letter-spacing:.02em;text-transform:uppercase;background-color:#12161f;border:1px solid #1e2635;border-radius:5px;cursor:pointer;text-decoration:none;outline:none;transition:background-color .2s ease,border-color .2s ease}',
	'.cs2tracker-btn:hover{background-color:#18202e;border-color:#007aef;text-decoration:none!important}',
	'.cs2tracker-btn__icon{height:20px;width:20px;flex:0 0 auto}',
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
