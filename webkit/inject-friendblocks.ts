import { buildProfileHref } from '../shared/cs2tracker';
import { isSteamId64 } from '../shared/steamid';
import { createIcon } from './icon';
import { registerDisposer } from './lifecycle';
import { STYLE_ELEMENT_ID, ensureStyles } from './styles';

/**
 * One selector for every friends surface. /friends/, /friends/coplay/, /friends/pending/,
 * /friends/blocked/ and group member listings are all built from the same row markup, so they need no
 * per-page handling -- and the injector never has to know which of them it is looking at.
 *
 * Measured against a live account's friends page: 95 .friend_block_v2 elements, 94 of them carrying
 * data-steamid. The attribute is part of the selector rather than a check inside the loop because a row
 * without it is a row this module can do nothing with, and leaving it out of the result set is what
 * keeps it genuinely untouched rather than marked and skipped.
 */
export const FRIEND_BLOCK_SELECTOR = '.friend_block_v2[data-steamid]';

/** Marks the badge this module owns. It is the style hook and the teardown key both. */
export const FRIEND_BADGE_CLASS = 'cs2tracker-friend-badge';

/**
 * The row's text container -- friend name and last-online line. Exported so a test can build a fixture
 * that has one, since where the badge mounts is the whole of its collision behaviour.
 *
 * Steam does not guarantee it: a row shape without this element still gets a badge, appended to the row.
 * That case is covered and is why the mount is a fallback rather than a requirement.
 */
export const FRIEND_CONTENT_SELECTOR = '.friend_block_content';

/** dataset key `cs2trackerInjected` maps to the `data-cs2tracker-injected` attribute. */
const INJECTED_MARKER = 'cs2trackerInjected';

/**
 * The badge is icon-only and createIcon marks the icon aria-hidden, so nothing inside the badge is
 * readable: an icon-only link whose only child is hidden from assistive tech has no accessible name at
 * all, and a screen reader announces "link" and stops. So the same string does two separate jobs and
 * both are required -- aria-label is the badge's entire accessible name, title is the sighted hover
 * affordance. Neither one substitutes for the other.
 */
const BADGE_LABEL = 'View on CS2Tracker';

/**
 * Badge every un-badged friend row in the document. Returns how many badges were added.
 *
 * The count is what the observer path relies on to stay quiet, and what a caller reads to decide whether
 * anything happened, so it counts badges actually appended -- never rows seen.
 */
export function injectFriendBlocks(doc: Document, openExternal: boolean): number {
	const rows = doc.querySelectorAll<HTMLElement>(FRIEND_BLOCK_SELECTOR);
	let injected = 0;

	rows.forEach((row) => {
		// The idempotency guard, and also the only thing that terminates observeFriendBlocks: the callback
		// re-runs this function, appending a badge is a childList mutation on the observed subtree, and that
		// mutation queues the callback again. Without the marker the second pass badges every row a second
		// time, which mutates the DOM again, which wakes the observer again, forever. The marker is written
		// on the row rather than inferred by querying it for an existing badge because it survives Steam
		// re-ordering the row's children, and because it is one attribute read per row instead of a
		// descendant query per row on a 94-row list.
		if (row.dataset[INJECTED_MARKER] === '1') return;

		// data-steamid is Steam's own attribute, so this is a sanity check on a trusted source rather than a
		// screen against hostile input. It stays because a value that is not a SteamID64 still builds a
		// plausible-looking CS2Tracker URL for an account that does not exist. A row that fails is skipped
		// silently and the sweep continues: throwing here would abandon the remaining rows over one bad one,
		// and on a real list the good rows are effectively all of them.
		const steamId = row.getAttribute('data-steamid')?.trim() ?? '';
		if (!isSteamId64(steamId)) return;

		row.dataset[INJECTED_MARKER] = '1';

		// An anchor with an href, deliberately -- not a div with a click handler. Tab-reachable, focusable,
		// openable with Enter, and Steam's own middle-click and context-menu behaviour comes free. It also
		// means the badge holds no event listener, so removing the element is the whole of its cleanup.
		const badge = doc.createElement('a');
		badge.className = FRIEND_BADGE_CLASS;
		badge.href = buildProfileHref(steamId, openExternal);
		badge.title = BADGE_LABEL;
		badge.setAttribute('aria-label', BADGE_LABEL);

		// Built per row, not once and reused. Appending a node moves it, so a shared icon would end up in
		// the last badge only and leave the other 93 empty -- webkit/icon.ts has a test pinning that each
		// call returns its own subtree for exactly this reason. The cost is one parse of a 739-byte constant
		// per row (measured at ~5.4ms for 94 rows under happy-dom, whose DOMParser is far slower than the
		// Blink one this actually runs on), paid once per full sweep. Avoiding it would mean caching inside
		// createIcon, which is that module's decision, not this one's.
		//
		// createIcon returns null when the markup will not parse. An empty badge is degraded but still a
		// working, named link -- the aria-label above is independent of the icon -- so the icon is optional
		// and its absence is not a reason to skip the row.
		const icon = createIcon(doc, '');
		if (icon) badge.appendChild(icon);

		// Into the row's text container when there is one, falling back to the row itself.
		//
		// This used to be an absolutely positioned corner badge on the row, and that was wrong for a reason
		// worth recording. The row's top-right corner is contested: a live client had a ban-checker browser
		// extension putting a 24x24 verdict image at the same coordinates, inside a wrapper carrying
		// z-index:10, so the badge rendered perfectly and every click landed on the extension's image
		// instead. Raising our z-index past theirs would have won the pixel and broken their feature -- the
		// same trade in the other direction -- and every other corner was covered by Steam's own
		// a.selectable_overlay, the row-wide link.
		//
		// Sitting in normal flow inside the same container removes the contest instead of winning it: two
		// badges lay out side by side, and it behaves identically whether or not that extension is present.
		// The stylesheet keeps a z-index on the badge, but now only to clear selectable_overlay rather than
		// to outrank another plugin.
		const mount = row.querySelector<HTMLElement>(FRIEND_CONTENT_SELECTOR) ?? row;
		mount.appendChild(badge);
		injected += 1;
	});

	// After the loop and only if something was badged. The stylesheet declares position:relative on Steam's
	// own .friend_block_v2, which re-anchors any absolutely positioned descendant Steam already has in a
	// row, so it is not inert: a page with nothing to badge has to be left exactly as it was found.
	if (injected > 0) ensureStyles(doc);
	return injected;
}

/**
 * The documents this module is already watching. A WeakMap, not a module-level flag, for the reason
 * webkit/styles.ts gives about its own idempotency check: the community browser runs this bundle against
 * every community page it opens and each of those is a separate document, so one flag would look
 * idempotent and leave every page after the first observed by nothing -- swept once at load and then
 * silently inert the moment Steam re-rendered the list. Weak keys mean a closed page's entry goes away
 * with the document.
 *
 * It records only that a document is observed. openExternal is captured by the callback rather than
 * tracked here, because it cannot change while a page is open: the design specifies that settings changes
 * are not pushed to already-open community pages, webkit reads settings once at page load, and the
 * setting's own description tells the user to reopen the page. See observeFriendBlocks for why tracking
 * it would be worse than useless rather than merely unnecessary.
 */
const observedDocuments = new WeakMap<Document, MutationObserver>();

/** nodeType of an element. Compared numerically because `instanceof Element` is per-realm. */
const ELEMENT_NODE = 1;

/**
 * True when every node added in this batch was added by this module -- a badge, or the stylesheet.
 *
 * The structural half of the loop guard. The marker guard already makes the self-triggered pass add
 * nothing, so this changes no outcome today; it is here because the consequence of losing that one `if`
 * is a frozen Steam tab rather than a failed assertion, and a runaway is worth stopping in two
 * independent places. It also skips a pointless full-document query on every wakeup this module caused
 * itself, which on a badged 94-row list is every wakeup but Steam's.
 *
 * Inspecting the batch, not calling observer.takeRecords(): taking the records would also discard any
 * Steam mutation that landed while the sweep was running, leaving a row unbadged until Steam happened to
 * touch the DOM again. Inspecting keeps a mixed batch -- ours plus Steam's -- on the sweeping path, since
 * one foreign node anywhere in it answers false.
 *
 * A batch with no added nodes at all answers true and is skipped, which is correct: attributes are not
 * observed, so such a batch is pure removals, and removing nodes cannot produce a row that needs a badge.
 */
function isSelfInflicted(records: MutationRecord[]): boolean {
	for (const record of records) {
		for (const node of record.addedNodes) {
			if (node.nodeType !== ELEMENT_NODE) return false;
			const element = node as Element;
			if (!element.classList.contains(FRIEND_BADGE_CLASS) && element.id !== STYLE_ELEMENT_ID) return false;
		}
	}
	return true;
}

/**
 * Badge the rows that are there now and keep badging the ones Steam adds later -- the friends page
 * re-renders its list as the user searches, filters and as friends come online.
 *
 * Safe to call repeatedly on the same document: each call sweeps, and only the first starts an observer.
 * That matters because the observer watches doc.documentElement with subtree:true, so it wakes on every
 * DOM change Steam makes; a second observer would double that work for the life of the page while adding
 * no badge the first one missed.
 *
 * Repeat calls have to pass the same openExternal, and nothing here can enforce it. Recording the latest
 * value for the callback to read would not fix a caller that changed it, only disguise the result: the
 * sweep skips every already-badged row, so the rows on screen would keep the old scheme while later ones
 * got the new one, leaving one document with two kinds of link in it. Changing the value means disposing
 * first, which drops the entry below and arms a fresh observer with a fresh capture. In Phase 1 that path
 * does not exist -- settings are read once per page load and are not pushed to an open page.
 */
export function observeFriendBlocks(doc: Document, openExternal: boolean): void {
	// First, and unconditionally. A MutationObserver reports changes made after observe() and never
	// replays existing nodes, so the rows already on screen are reachable only through this sweep.
	injectFriendBlocks(doc, openExternal);

	if (observedDocuments.has(doc)) return;

	const observer = new MutationObserver((records) => {
		if (isSelfInflicted(records)) return;
		injectFriendBlocks(doc, openExternal);
	});

	// childList and subtree only. Watching attributes as well would make the marker this module writes on
	// every badged row wake the observer, which is the same runaway the marker exists to prevent.
	observer.observe(doc.documentElement, { childList: true, subtree: true });
	observedDocuments.set(doc, observer);

	// Store review checks for observers that are never disconnected, and this one outlives the page it was
	// watching if nothing tears it down. The map entry is cleared alongside the disconnect so a later
	// observeFriendBlocks on the same document arms a fresh observer instead of finding a stale record and
	// watching nothing -- a plugin that works until the first time it is switched off and on again.
	registerDisposer(() => {
		observedDocuments.delete(doc);
		observer.disconnect();
	});
}

/**
 * Undo injectFriendBlocks. Safe on a document that was never badged.
 *
 * Clearing the markers is not tidying: a row left marked is permanently un-badgeable, because every
 * later sweep reads the marker and skips it. Removing the badges alone would leave a page that looks
 * clean and can never be injected again.
 *
 * Two things this deliberately does not do, both of which are the caller's to complete:
 *
 * The stylesheet stays. It is shared with the profile button, so tearing it down here could unstyle an
 * injection that has nothing to do with this teardown -- but it is not inert either. styles.ts records
 * that .friend_block_v2{position:relative} re-anchors Steam's own absolutely positioned row descendants,
 * so a page that has been un-badged is still carrying a layout change with nothing left to justify it.
 * Whoever owns both removers owes removeStyles(doc) after them.
 *
 * The observer stays connected. If one is running on this document it will re-badge every row the next
 * time Steam adds a node, so this belongs with disposeAll(), not on its own.
 */
export function removeFriendBadges(doc: Document): void {
	doc.querySelectorAll(`a.${FRIEND_BADGE_CLASS}`).forEach((badge) => badge.remove());
	doc.querySelectorAll<HTMLElement>(FRIEND_BLOCK_SELECTOR).forEach((row) => {
		delete row.dataset[INJECTED_MARKER];
	});
}
