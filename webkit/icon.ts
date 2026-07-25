/**
 * The CS2Tracker mark, inlined from assets/icon.svg. Regenerate that asset with
 * `pnpm run trace-icon`, then re-flatten it into this constant: the asset is exactly this markup with
 * a newline between elements, so deleting the newlines is the whole of the conversion. Flatten it
 * mechanically rather than retyping -- the path data is traced output, not hand-authored numbers.
 *
 * The viewBox is geometry, not packaging. The mark's arcs share an off-centre origin at
 * (22.62, 22.62) of this 0 0 40 40 box, so re-cropping it to something centred or square visibly
 * shifts every arc. Copy the box and all 5 paths verbatim or not at all.
 */
export const CS2TRACKER_ICON_SVG =
	'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40" width="40" height="40"><path fill="#7f8181" d="M32.992 24.345 L39.966 24.345 A17.432 17.432 0 0 1 24.345 39.966 L24.345 32.992 A10.515 10.515 0 0 0 32.992 24.345 Z"/><path fill="#ffffff" d="M20.894 32.992 L20.894 39.966 A17.432 17.432 0 0 1 5.273 24.345 L12.247 24.345 A10.515 10.515 0 0 0 20.894 32.992 Z"/><path fill="#007aef" d="M12.104 22.62 L0.006 22.62 A22.614 22.614 0 0 1 22.62 0.006 L22.62 12.104 A10.516 10.516 0 0 0 12.104 22.62 Z"/><path fill="#ffffff" d="M24.345 12.247 L24.345 5.273 A17.432 17.432 0 0 1 39.966 20.894 L32.992 20.894 A10.515 10.515 0 0 0 24.345 12.247 Z"/><path fill="#007aef" d="M22.62 22.62 L22.62 17.436 A5.184 5.184 0 1 1 17.436 22.62 Z"/></svg>';

/**
 * Build an icon node for the target document. Returns null if the markup will not parse, so callers
 * mount an icon or nothing rather than a browser error box.
 *
 * Parsed rather than assigned through innerHTML: the markup is a static constant with no
 * interpolation, and store review flags innerHTML on sight.
 *
 * A parse failure has two shapes and both are checked. They are two engines' conventions, not a real
 * browser versus a test double: Blink, which is what Steam's embedded browser is, reports the error by
 * inserting <parsererror> as a descendant of whatever partial root it built -- the same shape happy-dom
 * produces -- so querySelector is the branch that fires in production and under test.
 * Gecko instead makes <parsererror> the document element, and querySelector never matches the element
 * it is called on, so the nodeName check is the only guard for that shape. It is unreachable on a
 * Blink-shaped host and kept deliberately.
 *
 * importNode is what makes the result belong to `doc` -- a node built against another document throws
 * WrongDocumentError on insert -- and it copies, so every call hands back its own subtree.
 */
export function createIcon(doc: Document, className: string): Element | null {
	const parsed = new DOMParser().parseFromString(CS2TRACKER_ICON_SVG, 'image/svg+xml');
	const root = parsed.documentElement;
	if (!root || root.nodeName === 'parsererror' || root.querySelector('parsererror')) return null;

	const node = doc.importNode(root, true) as Element;
	node.setAttribute('class', className);
	node.setAttribute('aria-hidden', 'true');
	return node;
}
