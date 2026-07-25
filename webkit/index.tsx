import { observeFriendBlocks, removeFriendBadges } from './inject-friendblocks';
import { injectProfileButton, removeProfileButton } from './inject-profile';
import { disposeAll, registerDisposer } from './lifecycle';
import { isProfilePath, isSteamCommunityHost, waitForElement } from './routing';
import { readSettings } from './settings';
import { removeStyles } from './styles';

/**
 * The webkit entry point: the one module Millennium calls, running inside every web page the Steam client
 * opens.
 *
 * It is wiring and nothing else. Reading the page's own location and document is what makes it impossible
 * to unit test -- and reaching @steambrew/webkit through settings.ts is what makes it impossible to even
 * import outside Steam -- so every decision it would otherwise make was moved into webkit/routing.ts,
 * which the suite covers in full. What is left here is verified by hand against a live client.
 */

const RIGHT_COLUMN_SELECTOR = '.profile_rightcol';

/**
 * Undo everything this bundle did to the page, and stop everything it started.
 *
 * disposeAll comes first so that nothing can re-inject behind the removals: the friend-block observer is
 * still connected until it runs, and it re-badges every row the next time Steam touches the DOM.
 *
 * removeStyles comes last, and it is the reason this function exists rather than the entry just handing
 * disposeAll to the listener. Neither remover above touches the stylesheet -- each declines because the
 * other one might still need it -- so the only place it can be dropped is here, after both. It is not
 * inert, either: webkit/styles.ts records that `.friend_block_v2{position:relative}` makes every friend row
 * the containing block for Steam's own absolutely positioned row descendants, so a page left carrying the
 * sheet after teardown is a page carrying a layout change with nothing left to justify it.
 */
function teardown(): void {
	disposeAll();
	removeProfileButton(document);
	removeFriendBadges(document);
	removeStyles(document);
}

/**
 * A persisted pagehide is the page going into the back/forward cache, not going away: the document comes
 * back intact, the browser freezes and thaws its observers and timers for us, and Millennium does not re-run
 * this entry on a cache restore because no new document was created. Tearing down here would leave a
 * restored page with no button and no code left to put one back.
 *
 * Declared as a named module-level function rather than an inline closure so that the reference is stable.
 * addEventListener discards a duplicate (type, listener, capture) triple, so that identity is what makes a
 * second WebkitMain on the same page add no second listener.
 */
function handlePageHide(event: PageTransitionEvent): void {
	if (event.persisted) return;
	teardown();
}

export default async function WebkitMain(): Promise<void> {
	// First, before the settings read: on store.steampowered.com and every other page the Steam client
	// opens, the correct amount of work for this plugin to do is none, including no IPC.
	if (!isSteamCommunityHost(location.hostname)) return;

	// No `once: true`. The handler ignores a persisted pagehide, and `once` would remove the listener on
	// that ignored call and leave the page with nothing armed for the unload that really does end it.
	// Removal is explicit instead, through the registry, because a listener that outlives its page is the
	// third thing the store review looks for after observers and timers.
	window.addEventListener('pagehide', handlePageHide);
	registerDisposer(() => window.removeEventListener('pagehide', handlePageHide));

	const settings = await readSettings();

	// Only the profile button is gated on the path. The right column exists on profile pages and nowhere
	// else, so a wait armed anywhere else could only expire.
	if (settings.showOnProfiles && isProfilePath(location.pathname)) {
		waitForElement(document, RIGHT_COLUMN_SELECTOR, () => {
			// void, not await: nothing here needs the result, and injectProfileButton is documented never to
			// reject -- it answers false for every failure, including its own internal ones.
			void injectProfileButton(document, window, settings.openExternal);
		});
	}

	// Every community page, not just profiles. Friend rows are the same markup on /friends/,
	// /friends/coplay/, /friends/pending/, /friends/blocked/, group member listings and the friends widget
	// on a profile, so gating this on a path would mean enumerating Steam's surfaces and being wrong about
	// one. The injector's own row selector is the gate: a page with no friend rows gets one query and is
	// left untouched, down to the stylesheet.
	if (settings.showOnFriendLists) {
		observeFriendBlocks(document, settings.openExternal);
	}
}
