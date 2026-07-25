import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	FRIEND_BADGE_CLASS,
	FRIEND_CONTENT_SELECTOR,
	FRIEND_BLOCK_SELECTOR,
	injectFriendBlocks,
	observeFriendBlocks,
	removeFriendBadges,
} from '../webkit/inject-friendblocks';
import { disposeAll } from '../webkit/lifecycle';

/**
 * Steam's friend row, trimmed to the parts this module reads or has to coexist with. The
 * .selectable_overlay anchor is not filler: it is a link stretched over the whole row, so it is what the
 * badge has to sit on top of to be clickable. Keeping it in the fixture makes the DOM here the shape the
 * stylesheet was written against, even though paint order is the one thing no DOM test can check.
 */
function friendRow(steamId: string): string {
	return `<div class="selectable friend_block_v2 persona online" data-steamid="${steamId}" data-miniprofile="1">
			<a class="selectable_overlay" href="https://steamcommunity.com/id/example"></a>
			<div class="friend_block_content">Example</div>
		</div>`;
}

/**
 * happy-dom queues MutationObserver callbacks as macrotasks, so a microtask flush -- await
 * Promise.resolve(), or just asserting on the next line -- lands strictly before the observer has run.
 * Every observer case below has to cross a real timer or it asserts on the DOM as it was.
 */
const macrotask = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 20));

/**
 * disposeAll first: the registry is module state shared with every other file in the suite, and an
 * observer left connected from the previous test would keep sweeping this one's fixture.
 */
beforeEach(() => {
	disposeAll();
	document.head.innerHTML = '';
	document.body.innerHTML = '';
});

// The observer cases spy on MutationObserver.prototype and one injector case spies on the ambient
// document's importNode. Either left installed would distort whatever ran next.
afterEach(() => {
	disposeAll();
	vi.restoreAllMocks();
});

describe('injectFriendBlocks', () => {
	/**
	 * Two rows with two different ids, asserted position by position, because the defect this catches is
	 * the module resolving one SteamID for the page -- the profile owner's, or the first row's -- and
	 * pointing every badge at it. A one-row fixture cannot tell that apart from correct behaviour, and
	 * neither can a two-row fixture that only counts badges.
	 */
	it('adds one badge per row, each linking to its own SteamID', () => {
		document.body.innerHTML = friendRow('76561198145891996') + friendRow('76561198314937074');
		expect(injectFriendBlocks(document, false)).toBe(2);

		const badges = document.querySelectorAll(`a.${FRIEND_BADGE_CLASS}`);
		expect(badges).toHaveLength(2);
		expect(badges[0].getAttribute('href')).toBe('https://cs2tracker.gg/stats/76561198145891996');
		expect(badges[1].getAttribute('href')).toBe('https://cs2tracker.gg/stats/76561198314937074');
	});

	/**
	 * The mount point is the whole of this badge's collision behaviour, so it is asserted exactly.
	 *
	 * It was a direct child of the row, positioned absolutely into the top-right corner. A live client
	 * showed why that fails: a ban-checker browser extension held the same corner with a 24x24 image inside
	 * a wrapper at z-index 10, so the badge rendered and every click landed on the extension's image. The
	 * other three corners were covered by Steam's row-wide a.selectable_overlay.
	 *
	 * Mounting into .friend_block_content -- the same container that extension uses -- puts both badges in
	 * normal flow, side by side, so neither covers the other and the result is the same whether or not that
	 * extension is installed. Reverting to row.appendChild fails this.
	 */
	it('mounts the badge in the row content, beside anything else living there', () => {
		document.body.innerHTML = friendRow('76561198145891996');
		injectFriendBlocks(document, false);
		const row = document.querySelector('.friend_block_v2')!;
		const badge = row.querySelector(`a.${FRIEND_BADGE_CLASS}`);
		expect(badge).not.toBeNull();
		expect(badge!.parentElement).toBe(row.querySelector(FRIEND_CONTENT_SELECTOR));
	});

	/**
	 * Steam does not guarantee the content container, so the mount is a fallback rather than a requirement.
	 * Without this, a row shape lacking it would silently get no badge -- the failure mode this whole module
	 * has been bitten by twice.
	 */
	it('falls back to the row when it has no content container', () => {
		document.body.innerHTML =
			'<div class="selectable friend_block_v2 persona online" data-steamid="76561198145891996"></div>';
		expect(injectFriendBlocks(document, false)).toBe(1);
		const row = document.querySelector('.friend_block_v2')!;
		expect(row.querySelector(`a.${FRIEND_BADGE_CLASS}`)!.parentElement).toBe(row);
	});

	it('uses the external URL scheme when openExternal is on', () => {
		document.body.innerHTML = friendRow('76561198145891996');
		injectFriendBlocks(document, true);
		expect(document.querySelector(`a.${FRIEND_BADGE_CLASS}`)!.getAttribute('href')).toBe(
			'steam://openurl_external/https://cs2tracker.gg/stats/76561198145891996',
		);
	});

	/**
	 * The marker guard, and it is doing two jobs at once. Obviously it stops a second sweep double-badging
	 * a row. Less obviously it is the only thing that terminates the observer: the callback re-runs this
	 * function, appending a badge is a childList mutation, and that mutation re-queues the callback. Drop
	 * the guard and observeFriendBlocks appends badges until the page dies.
	 */
	it('is idempotent', () => {
		document.body.innerHTML = friendRow('76561198145891996');
		expect(injectFriendBlocks(document, false)).toBe(1);
		expect(injectFriendBlocks(document, false)).toBe(0);
		expect(document.querySelectorAll(`a.${FRIEND_BADGE_CLASS}`)).toHaveLength(1);
	});

	/**
	 * data-steamid is Steam's own attribute, so this is a sanity check on a trusted source rather than a
	 * screen against hostile input -- but a value that is not a SteamID64 still builds a CS2Tracker URL
	 * for an account that does not exist. All three fixtures earn their place:
	 *
	 * 'not-an-id' fails on shape. '12345678901234567' is 17 digits, so it passes any digit-count test
	 * while sitting far below the individual-account base, and only the BigInt range check rejects it.
	 *
	 * The empty one is the case the selector cannot help with: [data-steamid] tests the attribute's
	 * presence, not its value, so an empty attribute is a matched row with nothing in it. Without it,
	 * weakening the guard to `if (steamId && !isSteamId64(steamId)) return;` passes this entire file and
	 * ships a badge pointing at a bare https://cs2tracker.gg/stats/ with no account on the end.
	 */
	it('skips rows whose data-steamid is not a SteamID64', () => {
		document.body.innerHTML = friendRow('not-an-id') + friendRow('12345678901234567') + friendRow('');
		expect(injectFriendBlocks(document, false)).toBe(0);
		expect(document.querySelectorAll(`a.${FRIEND_BADGE_CLASS}`)).toHaveLength(0);
	});

	/**
	 * The trim, which no other fixture reaches: delete it and every case here still passes while a padded
	 * attribute becomes a skipped row, because isSteamId64 accepts exactly 17 digits and nothing else. It
	 * has to be that strict -- BigInt() silently tolerates surrounding whitespace and a leading '+' -- so
	 * the trim is the module's job, not the validator's. Steam is not expected to emit padding; the point
	 * is that the module either handles it or must not appear to.
	 */
	it('trims the attribute before validating it', () => {
		document.body.innerHTML = friendRow(' 76561198145891996 ');
		expect(injectFriendBlocks(document, false)).toBe(1);
		expect(document.querySelector(`a.${FRIEND_BADGE_CLASS}`)!.getAttribute('href')).toBe(
			'https://cs2tracker.gg/stats/76561198145891996',
		);
	});

	/**
	 * The other half of the rule above: skip the row, do not abandon the list. A throw or an early return
	 * out of the sweep passes the all-bad fixture above, because there is nothing after the bad rows to
	 * lose. One malformed row between two good ones is what separates "skipped" from "stopped", and on a
	 * real friends list the good rows are the overwhelming majority.
	 */
	it('keeps sweeping past a row it has to skip', () => {
		document.body.innerHTML =
			friendRow('76561198145891996') + friendRow('not-an-id') + friendRow('76561198314937074');
		expect(() => injectFriendBlocks(document, false)).not.toThrow();

		const badges = document.querySelectorAll(`a.${FRIEND_BADGE_CLASS}`);
		expect(badges).toHaveLength(2);
		expect(badges[1].getAttribute('href')).toBe('https://cs2tracker.gg/stats/76561198314937074');
		expect(document.querySelector('.friend_block_v2[data-steamid="not-an-id"] a')!.className).toBe(
			'selectable_overlay',
		);
	});

	/**
	 * The stylesheet declares position:relative on Steam's own .friend_block_v2, which re-anchors any
	 * absolutely positioned descendant Steam already has in a row. That is a change to Steam's layout, so
	 * a page with nothing to badge -- most community pages -- has to be left exactly as it was found.
	 */
	it('injects the stylesheet only when a row was badged', () => {
		document.body.innerHTML = '<div class="not_a_friend_row"></div>';
		expect(injectFriendBlocks(document, false)).toBe(0);
		expect(document.getElementById('cs2tracker-extension-style')).toBeNull();

		document.body.innerHTML = friendRow('76561198145891996');
		injectFriendBlocks(document, false);
		expect(document.getElementById('cs2tracker-extension-style')).not.toBeNull();
	});

	/**
	 * The badge is icon-only and createIcon marks the icon aria-hidden, so there is no text anywhere
	 * inside it. An icon-only link whose only child is hidden from assistive tech has no accessible name
	 * at all: a screen reader announces "link" and nothing else. aria-label is therefore the badge's
	 * entire name, and title is the separate, sighted hover affordance -- neither substitutes for the
	 * other. The empty-text and aria-hidden assertions are what make that load-bearing rather than
	 * decorative: they prove there is no other source of a name to fall back on.
	 */
	it('names the badge for assistive tech as well as for hover', () => {
		document.body.innerHTML = friendRow('76561198145891996');
		injectFriendBlocks(document, false);

		const badge = document.querySelector(`a.${FRIEND_BADGE_CLASS}`)!;
		expect(badge.getAttribute('aria-label')).toBe('View on CS2Tracker');
		expect(badge.getAttribute('title')).toBe('View on CS2Tracker');
		expect(badge.textContent!.trim()).toBe('');
		expect(badge.querySelector('svg')!.getAttribute('aria-hidden')).toBe('true');
	});

	/**
	 * createIcon re-parses its 739-byte constant on every call, which is a real temptation to build one
	 * node and reuse it across the sweep. A shared node does not appear in every badge; appending it moves
	 * it, so the last row gets the icon and the other 93 get an empty badge. Two distinct nodes with their
	 * full subtrees is what rules that out.
	 */
	it('gives every badge its own icon', () => {
		document.body.innerHTML = friendRow('76561198145891996') + friendRow('76561198314937074');
		injectFriendBlocks(document, false);

		const icons = document.querySelectorAll(`a.${FRIEND_BADGE_CLASS} > svg`);
		expect(icons).toHaveLength(2);
		expect(icons[0]).not.toBe(icons[1]);
		expect(icons[0].querySelectorAll('path')).toHaveLength(5);
		expect(icons[1].querySelectorAll('path')).toHaveLength(5);
	});

	/**
	 * A whole friends list, at the size a live account actually produces: 95 .friend_block_v2 elements of
	 * which 94 carry data-steamid. The row without the attribute is the measured reality, not padding --
	 * it is why the attribute is part of the selector instead of a check inside the loop -- and it also
	 * pins that a row this module cannot badge is left completely alone rather than badged with an empty
	 * href.
	 */
	it('badges a full friends list without disturbing the row it cannot read', () => {
		const rows: string[] = [];
		for (let i = 0; i < 94; i++) {
			rows.push(friendRow((BigInt('76561198000000000') + BigInt(i)).toString()));
		}
		rows.push(
			'<div class="selectable friend_block_v2 persona offline"><div class="friend_block_content">No id</div></div>',
		);
		document.body.innerHTML = rows.join('');

		expect(document.querySelectorAll('.friend_block_v2')).toHaveLength(95);
		expect(document.querySelectorAll(FRIEND_BLOCK_SELECTOR)).toHaveLength(94);
		expect(injectFriendBlocks(document, false)).toBe(94);
		expect(document.querySelectorAll(`a.${FRIEND_BADGE_CLASS}`)).toHaveLength(94);

		const unreadable = document.querySelector('.friend_block_v2:not([data-steamid])')!;
		expect(unreadable.querySelector(`a.${FRIEND_BADGE_CLASS}`)).toBeNull();
		expect(unreadable.hasAttribute('data-cs2tracker-injected')).toBe(false);
		expect(document.querySelectorAll(`a.${FRIEND_BADGE_CLASS}`)[93].getAttribute('href')).toBe(
			'https://cs2tracker.gg/stats/76561198000000093',
		);
	});

	/**
	 * Every other case here passes the ambient document, which leaves all of this module's `doc` uses
	 * satisfied by the global and therefore unpinned -- swapping any one of them for `document` keeps the
	 * file green. The community browser hands this bundle a separate document per community page, and both
	 * sibling modules already carry this test.
	 *
	 * It is white-box on purpose. happy-dom adopts a foreign node on insert, recursively and without
	 * throwing, so a badge built by the wrong document still reports `other` as its ownerDocument once
	 * appended. Adoption launders every downstream signal, so the only observable difference is which
	 * document was asked to do the work: importNode for the icon, createElement for the anchor.
	 */
	it('operates on the document it is given, not the ambient one', () => {
		const other = document.implementation.createHTMLDocument('other');
		other.body.innerHTML = friendRow('76561198145891996');
		const ambientImportNode = vi.spyOn(document, 'importNode');
		const ambientCreateElement = vi.spyOn(document, 'createElement');

		expect(injectFriendBlocks(other, false)).toBe(1);

		const badge = other.querySelector(`a.${FRIEND_BADGE_CLASS}`);
		expect(badge).not.toBeNull();
		expect(badge!.parentElement).toBe(other.querySelector(FRIEND_CONTENT_SELECTOR));
		expect(badge!.querySelector('svg')).not.toBeNull();
		expect(other.getElementById('cs2tracker-extension-style')).not.toBeNull();
		expect(ambientImportNode).not.toHaveBeenCalled();
		expect(ambientCreateElement).not.toHaveBeenCalled();

		expect(document.querySelector(`a.${FRIEND_BADGE_CLASS}`)).toBeNull();
		expect(document.getElementById('cs2tracker-extension-style')).toBeNull();
	});
});

describe('observeFriendBlocks', () => {
	/**
	 * A MutationObserver reports changes made after observe() and never replays what is already there, so
	 * the rows on screen when this starts are reachable only through the initial sweep. Dropping that one
	 * call leaves the friends page unbadged until Steam next touches the DOM, and passes the
	 * added-later case below.
	 */
	it('badges rows already on the page when it starts', () => {
		document.body.innerHTML = friendRow('76561198145891996');
		observeFriendBlocks(document, false);
		expect(document.querySelectorAll(`a.${FRIEND_BADGE_CLASS}`)).toHaveLength(1);
	});

	it('badges rows added after the observer starts', async () => {
		document.body.innerHTML = '<div id="list"></div>';
		observeFriendBlocks(document, false);

		document.getElementById('list')!.innerHTML = friendRow('76561198145891996');
		await macrotask();

		expect(document.querySelectorAll(`a.${FRIEND_BADGE_CLASS}`)).toHaveLength(1);
	});

	/**
	 * The classic way to write an infinite loop is to mutate the DOM from inside a MutationObserver, which
	 * is exactly what this does: the callback appends a badge, and appending is a childList mutation on the
	 * observed subtree, so the callback is queued again. It terminates only because the second pass finds
	 * every row already marked and changes nothing.
	 *
	 * The snapshot across two further macrotasks is the assertion. Counting badges once would pass a module
	 * that has settled and a module that is one iteration into a runaway; the DOM having stopped changing
	 * is the property that separates them.
	 */
	it('settles instead of looping when its own badge wakes the observer', async () => {
		document.body.innerHTML = '<div id="list"></div>';
		observeFriendBlocks(document, false);

		document.getElementById('list')!.innerHTML = friendRow('76561198145891996');
		await macrotask();
		const settled = document.body.innerHTML;
		await macrotask();
		await macrotask();

		expect(document.body.innerHTML).toBe(settled);
		expect(document.querySelectorAll(`a.${FRIEND_BADGE_CLASS}`)).toHaveLength(1);
	});

	/**
	 * Two calls, one observer. Every extra observer sweeps the document again on every mutation Steam makes
	 * for the life of the page, and none of them adds a badge the first one missed -- the marker guard
	 * makes their DOM effect identical, which is precisely why nothing else in this file would notice.
	 *
	 * The repeat call still has to sweep, though: the caller re-runs this when the settings change. So the
	 * row is inserted between the two calls and asserted badged, which rules out buying idempotency by
	 * making the second call return early.
	 */
	it('starts one observer per document however often it is called', () => {
		const observe = vi.spyOn(MutationObserver.prototype, 'observe');
		document.body.innerHTML = '<div id="list"></div>';

		observeFriendBlocks(document, false);
		document.getElementById('list')!.innerHTML = friendRow('76561198145891996');
		observeFriendBlocks(document, false);

		expect(observe).toHaveBeenCalledOnce();
		expect(document.querySelectorAll(`a.${FRIEND_BADGE_CLASS}`)).toHaveLength(1);
	});

	/**
	 * The per-document half of the guard above, and the whole reason it is a WeakMap rather than a boolean.
	 * Substituting `let observed = false`, cleared in the disposer, passes every other case in this file,
	 * because no other case arms a second document -- and webkit/styles.ts records exactly this mistake in
	 * its own module: a module-level "already injected" flag looks idempotent and leaves every page after
	 * the first unstyled. Here it leaves every friends page after the first badged once at load and then
	 * inert, so it stops badging the moment Steam re-renders the list.
	 *
	 * The row is inserted into the second document, not the first, so the assertion is that the second
	 * document is genuinely observed rather than merely counted.
	 */
	it('arms every document separately, not just the first', async () => {
		const observe = vi.spyOn(MutationObserver.prototype, 'observe');
		document.body.innerHTML = '<div id="list"></div>';
		const second = document.implementation.createHTMLDocument('second');
		second.body.innerHTML = '<div id="list"></div>';

		observeFriendBlocks(document, false);
		observeFriendBlocks(second, false);
		expect(observe).toHaveBeenCalledTimes(2);

		second.getElementById('list')!.innerHTML = friendRow('76561198145891996');
		await macrotask();

		expect(second.querySelectorAll(`a.${FRIEND_BADGE_CLASS}`)).toHaveLength(1);
		expect(document.querySelectorAll(`a.${FRIEND_BADGE_CLASS}`)).toHaveLength(0);
	});

	/**
	 * The structural backstop, which is hardening and not a fix: the marker guard already makes the
	 * self-triggered pass add nothing, so no DOM assertion can tell a module that recognises its own
	 * mutations from one that re-queries the whole document every time it wakes itself. The sweep count is
	 * the only observable, which is why this is a spy. It is worth having because losing the marker guard
	 * does not fail an assertion, it freezes the tab.
	 *
	 * Exactly one sweep: Steam's insertion earns it, and the badge and stylesheet that sweep appends must
	 * not earn a second. Counting only calls with FRIEND_BLOCK_SELECTOR keeps the test's own queries and
	 * anything happy-dom does internally out of the total.
	 */
	it('skips the wasted sweep when the only added nodes are its own', async () => {
		document.body.innerHTML = '<div id="list"></div>';
		observeFriendBlocks(document, false);
		const sweeps = vi.spyOn(document, 'querySelectorAll');

		document.getElementById('list')!.innerHTML = friendRow('76561198145891996');
		await macrotask();
		await macrotask();

		expect(sweeps.mock.calls.filter(([selector]) => selector === FRIEND_BLOCK_SELECTOR)).toHaveLength(1);
		expect(document.querySelectorAll(`a.${FRIEND_BADGE_CLASS}`)).toHaveLength(1);
	});

	/**
	 * The store's review process checks for observers that are never disconnected, and this one watches
	 * doc.documentElement with subtree:true -- it wakes on every DOM change Steam makes for the life of the
	 * page. Without the registerDisposer call it survives teardown and keeps rewriting a page the plugin
	 * has been switched off for. The disconnect spy names that defect directly; the badge count is the
	 * behavioural proof that the disconnect took effect.
	 */
	it('stops observing once disposed', async () => {
		const disconnect = vi.spyOn(MutationObserver.prototype, 'disconnect');
		document.body.innerHTML = '<div id="list"></div>';
		observeFriendBlocks(document, false);
		disposeAll();
		expect(disconnect).toHaveBeenCalledOnce();

		document.getElementById('list')!.innerHTML = friendRow('76561198145891996');
		await macrotask();

		expect(document.querySelectorAll(`a.${FRIEND_BADGE_CLASS}`)).toHaveLength(0);
	});

	/**
	 * Disposal and single-instancing pull against each other, and this is where they meet. Whatever records
	 * that a document is already observed has to be cleared when the observer is disconnected, or the next
	 * observeFriendBlocks on that document sweeps once and then silently never watches again -- a plugin
	 * that works until the first time it is toggled off and on. Both the earlier tests pass either way.
	 */
	it('can be re-armed after disposal', async () => {
		document.body.innerHTML = '<div id="list"></div>';
		observeFriendBlocks(document, false);
		disposeAll();
		observeFriendBlocks(document, false);

		document.getElementById('list')!.innerHTML = friendRow('76561198145891996');
		await macrotask();

		expect(document.querySelectorAll(`a.${FRIEND_BADGE_CLASS}`)).toHaveLength(1);
	});
});

describe('removeFriendBadges', () => {
	/**
	 * Teardown has to leave the page injectable again, which is why the re-injection count is the real
	 * assertion here. Removing the badges but leaving data-cs2tracker-injected behind looks like a clean
	 * page and is permanently un-badgeable: every later sweep reads the marker and skips the row. The
	 * plugin would then work exactly once per page load.
	 */
	it('removes every badge and clears the injected markers', () => {
		document.body.innerHTML = friendRow('76561198145891996');
		injectFriendBlocks(document, false);
		removeFriendBadges(document);

		expect(document.querySelectorAll(`a.${FRIEND_BADGE_CLASS}`)).toHaveLength(0);
		expect(injectFriendBlocks(document, false)).toBe(1);
	});

	it('is safe on a document that was never badged', () => {
		document.body.innerHTML = friendRow('76561198145891996');
		expect(() => removeFriendBadges(document)).not.toThrow();
		expect(document.querySelectorAll(`a.${FRIEND_BADGE_CLASS}`)).toHaveLength(0);
	});

	/**
	 * The sibling module records this exact mutation surviving a whole suite: teardown reading the ambient
	 * document instead of the one it was handed. It passes every other case in this file, and in the
	 * community browser it means switching the plugin off on one page strips the badges from a different
	 * one and leaves the page in front of the user untouched.
	 */
	it('removes from the document it is given and leaves the others alone', () => {
		const other = document.implementation.createHTMLDocument('other');
		document.body.innerHTML = friendRow('76561198145891996');
		other.body.innerHTML = friendRow('76561198145891996');
		injectFriendBlocks(document, false);
		injectFriendBlocks(other, false);

		removeFriendBadges(other);
		expect(other.querySelector(`a.${FRIEND_BADGE_CLASS}`)).toBeNull();
		expect(document.querySelector(`a.${FRIEND_BADGE_CLASS}`)).not.toBeNull();
		expect(document.querySelector('.friend_block_v2')!.hasAttribute('data-cs2tracker-injected')).toBe(true);
	});
});
