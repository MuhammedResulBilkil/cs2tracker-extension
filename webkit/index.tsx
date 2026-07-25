import { observeFriendBlocks } from './inject-friendblocks';
import { PROFILE_COLUMN_SELECTOR, injectProfileButton } from './inject-profile';
import { registerDisposer } from './lifecycle';
import { isSteamCommunityHost, plannedInjection, waitForElement } from './routing';
import { readSettings } from './settings';
import { teardown } from './teardown';

/**
 * The webkit entry point: the one module Millennium calls, running inside every web page the Steam client
 * opens.
 *
 * It is wiring and nothing else. Reading the page's own location and document is what makes it impossible to
 * unit test -- and reaching @steambrew/webkit through settings.ts is what makes it impossible to even import
 * outside Steam -- so everything that carries a decision has been moved out: the route guards and the DOM
 * waiter into webkit/routing.ts, the payload decode into shared/settings.ts, and the removal chain into
 * webkit/teardown.ts. All three are covered by the suite. What is left here is verified by hand against a
 * live client, and it is deliberately the shortest list that can be.
 */

/**
 * A persisted pagehide is the page entering the back/forward cache, not going away: the document comes back
 * intact, the browser freezes and thaws its observers and timers for us, and Millennium does not re-run this
 * entry on a cache restore because no new document was created. Tearing down there would leave a restored
 * page with no button and no code left to put one back.
 *
 * Not load-bearing, as it turns out -- every injection path in this bundle is idempotent, so both branches of
 * the assumption behind it are safe -- but of two safe branches this is the one that cannot lose the button.
 *
 * Declared as a named module-level function rather than an inline closure so the reference is stable.
 * addEventListener discards a duplicate (type, listener, capture) triple, and that identity is what makes a
 * second WebkitMain on the same page add no second listener.
 */
function handlePageHide(event: PageTransitionEvent): void {
	if (event.persisted) return;
	teardown(document);
}

export default async function WebkitMain(): Promise<void> {
	// First, before the settings read: on store.steampowered.com and every other page the Steam client opens,
	// the correct amount of work for this plugin to do is none, including no IPC.
	if (!isSteamCommunityHost(location.hostname)) return;

	// Set by the disposer below, read after the await. A teardown landing while this function is suspended on
	// the IPC round trip is not hypothetical -- pagehide fires whenever the user navigates during it -- and
	// without this flag the continuation resumes on a torn-down page and arms a friend-block observer, a second
	// observer and a fifteen-second timer, and re-injects the stylesheet, with the pagehide listener already
	// removed and so nothing left to clean any of it up. It is bounded by the document's lifetime, which is
	// precisely the argument webkit/lifecycle.ts was written to reject.
	let tornDown = false;

	// No `once: true`. The handler ignores a persisted pagehide, and `once` would spend the listener on that
	// ignored call and leave the page with nothing armed for the unload that really does end it. Removal is
	// explicit instead, through the registry, because a listener that outlives its page is the third thing the
	// store review looks for after observers and timers.
	window.addEventListener('pagehide', handlePageHide);
	registerDisposer(() => {
		tornDown = true;
		window.removeEventListener('pagehide', handlePageHide);
	});

	const settings = await readSettings();
	if (tornDown) return;

	// Which toggle gates which feature, and that only the profile button is path-gated, is decided in
	// webkit/routing.ts rather than here. Both branches below read as obviously right either way round, which
	// is the problem: exchanging the two keys is invisible in review, passes every test, and ships two toggles
	// doing each other's job. Over there the suite can state the mapping; here there is nothing left to get
	// wrong but the dispatch.
	const plan = plannedInjection(settings, location.pathname);

	if (plan.profileButton) {
		waitForElement(document, PROFILE_COLUMN_SELECTOR, () => {
			// void, not await: nothing here needs the result, and injectProfileButton is documented never to
			// reject -- it answers false for every failure, including its own internal ones.
			void injectProfileButton(document, window, settings.openExternal);
		});
	}

	if (plan.friendBadges) {
		observeFriendBlocks(document, settings.openExternal);
	}
}
