import type { PluginSettings } from '../shared/settings';
import { registerDisposer } from './lifecycle';

/**
 * This module holds every decision the entry point makes, and imports nothing but the disposer registry.
 *
 * That is deliberate rather than tidy. webkit/index.tsx reaches @steambrew/webkit through settings.ts, and
 * @steambrew/webkit exists only inside the Steam client, so a test that imports the entry cannot load at
 * all. Anything left in the entry is verified by hand against a live client; anything moved here is
 * verified by the suite. So the entry keeps only the wiring -- read the globals, call these, hand the
 * results to the injectors -- and every branch worth being sure about lives on this side of the line.
 */

/**
 * Matches steamcommunity.com and any subdomain of it, and nothing else.
 *
 * Both ends carry weight. `(^|\.)` is what makes evil-steamcommunity.com a different host rather than a
 * subdomain: the character before the name has to be a label separator or nothing at all. `$` is what
 * makes steamcommunity.com.evil.net a different host: the name has to run to the end, not merely appear.
 * Drop either one and the guard admits a page that can serve any markup it likes to a bundle that reads
 * SteamIDs out of the DOM and builds links from them.
 */
const COMMUNITY_HOST_PATTERN = /(^|\.)steamcommunity\.com$/;

/**
 * Matches a community profile URL path: /profiles/{steamid64} or /id/{vanity}, with or without a trailing
 * slash, and with or without further segments after it.
 *
 * `[^/]+` and not `[^/]*`: /profiles/ with nothing after it names no account. The trailing separator is
 * matched rather than optional-then-anchored because a profile sub-page -- /id/{vanity}/games/ and its
 * siblings -- is still that account's profile, and whether Steam renders .profile_rightcol on any of them
 * is not answerable offline. Being permissive here costs one waitForElement that finds nothing and
 * expires; being strict would drop the button from any sub-page that does render the column. The column
 * itself is the real gate, and this only has to answer "plausibly a profile".
 */
const PROFILE_PATH_PATTERN = /^\/(id|profiles)\/[^/]+/;

/**
 * How long waitForElement watches before giving up.
 *
 * Generous on purpose. It is not a deadline the user notices -- nothing is waiting on it, and expiring costs
 * a console line rather than a broken page -- it is the point at which an observer watching the whole
 * document stops being worth its cost on a page that was never going to render the element. A community page
 * that has not laid out its sidebar within fifteen seconds is a page where Steam, not this plugin, is the
 * thing that is slow. It is also the number that ends up in the warning, so it should stay round.
 */
const DEFAULT_TIMEOUT_MS = 15000;

/** True only for steamcommunity.com and its subdomains. Pass `location.hostname`. */
export function isSteamCommunityHost(hostname: string): boolean {
	return COMMUNITY_HOST_PATTERN.test(hostname);
}

/** True for a community profile path. Pass `location.pathname`. */
export function isProfilePath(pathname: string): boolean {
	return PROFILE_PATH_PATTERN.test(pathname);
}

/** Which of the two injections a page should get. */
export interface InjectionPlan {
	profileButton: boolean;
	friendBadges: boolean;
}

/**
 * Decide which injections this page gets, from the settings and the path.
 *
 * This is the mapping from a user's two toggles to the two features they name, and it is here rather than
 * inline in the entry because it was the last decision in the bundle that no test could reach. The entry
 * imports @steambrew/webkit transitively and so cannot be imported by the suite at all, which meant the
 * mapping could be wrong in the one way that costs nothing to write and everything to ship: exchange the two
 * keys and the whole suite still passes, CI stays green, and every user's "Show on profile pages" toggle
 * silently operates the friend badges while "Show on friend lists" operates the profile button. Nothing
 * throws, nothing looks broken, and each toggle appears to work -- on the wrong feature. Moving it here is
 * what makes tests/webkit-entry.test.ts able to state which key gates which feature.
 *
 * The asymmetry is the other half of what is worth pinning, and it is deliberate rather than an oversight in
 * one of the two branches:
 *
 * **The profile button is path-gated.** `.profile_rightcol` exists on profile pages and nowhere else, so a
 * waiter armed on any other page could only run its observer over Steam's mutations for fifteen seconds and
 * then log a line about a selector that was never going to match.
 *
 * **The badges are not.** Friend rows are the same `.friend_block_v2[data-steamid]` markup on /friends/,
 * /friends/coplay/, /friends/pending/, /friends/blocked/, group member listings and the friends widget on a
 * profile, so gating them on a path would mean enumerating Steam's surfaces and being wrong about one of
 * them -- silently, as a page that simply never gets badges. The injector's own row selector is the gate
 * instead: a page with no friend rows costs one query and is left untouched, down to the stylesheet.
 *
 * `openExternal` is deliberately absent. It selects which browser a link opens in, so it belongs to the
 * injectors' arguments and not to this decision; if it ever appeared here it would be gating a feature on a
 * setting that has nothing to say about whether that feature should exist. tests/webkit-entry.test.ts pins
 * that both plans are indifferent to it.
 */
export function plannedInjection(settings: PluginSettings, pathname: string): InjectionPlan {
	return {
		profileButton: settings.showOnProfiles && isProfilePath(pathname),
		friendBadges: settings.showOnFriendLists,
	};
}

/**
 * Run `run` as soon as `selector` matches in `doc`, or never, if it has not matched within `timeoutMs`.
 *
 * Steam builds community pages progressively, so the element the profile injector needs is usually not
 * there when this bundle first runs -- and polling for it would either be too slow to beat the user's eye
 * or busy work for the whole life of the page.
 *
 * The callback runs at most once, and both the observer and the timer are released on every exit path:
 * matched, expired, or disposed mid-wait. That is not housekeeping. An observer watching documentElement
 * with subtree:true wakes on every change Steam makes for as long as it stays connected, and the store
 * review rejects a plugin that leaves one behind -- so a waiter that has finished has to be as absent as
 * one that was never started. None of it is observable through the callback, which is why
 * tests/webkit-entry.test.ts asserts on the timer count and the disconnect directly.
 */
export function waitForElement(
	doc: Document,
	selector: string,
	run: () => void,
	timeoutMs: number = DEFAULT_TIMEOUT_MS,
): void {
	// Before anything is armed, so the common case where Steam has already rendered the element starts no
	// observer, no timer and no disposer at all.
	if (doc.querySelector(selector)) {
		run();
		return;
	}

	let settled = false;
	let timer: ReturnType<typeof setTimeout> | undefined;

	/**
	 * The single exit. Idempotent, because all three paths lead here and two of them can race: the timer
	 * can come due while a mutation batch is queued, and disposeAll can arrive during either.
	 *
	 * The `timer !== undefined` guard is not defending against a call that can happen today. Nothing reaches
	 * stop() before the assignment below: a MutationObserver never invokes its callback synchronously from
	 * observe(), the timer cannot fire before it has been created, and the disposer is registered afterwards.
	 * It is here because `timer` is typed `| undefined` -- it has to be, since it is assigned after the
	 * closure that reads it -- and a function that is total over its own declared types cannot be broken by a
	 * later edit moving a stop() above the assignment. Cheaper than the comment explaining why it is safe to
	 * leave out.
	 */
	const stop = () => {
		if (settled) return;
		settled = true;
		observer.disconnect();
		if (timer !== undefined) clearTimeout(timer);
	};

	/**
	 * Giving up, as distinct from being stopped. Split from stop() so only this path logs: a waiter torn down
	 * with the page, or one that found what it wanted, has nothing to report.
	 *
	 * The warning is here because expiry was the one silent failure left in the bundle -- every other path
	 * that fails says so. A renamed or mistyped selector produces no button, no error and no output, which is
	 * indistinguishable from the user having switched the feature off. One line turns that from guesswork
	 * into a diagnosis, and it can only ever print once per waiter.
	 */
	const expire = () => {
		if (settled) return;
		stop();
		console.warn(`[CS2Tracker] Gave up waiting for "${selector}" after ${timeoutMs}ms.`);
	};

	// `observer` is referenced by stop() above and declared here: the two are mutually recursive and one of
	// them has to come second. Nothing calls stop() before this line has run, so the reference is always
	// resolved by the time it is read.
	const observer = new MutationObserver(() => {
		// The `settled` half is not redundant with stop()'s own guard. disconnect() drops the pending record
		// queue, but a batch already handed to the callback is past that point, and without this check an
		// expired waiter still runs its callback on the way out.
		if (settled || !doc.querySelector(selector)) return;

		// Cleanup first, then the callback. Ordered this way so a run() that throws -- it is somebody else's
		// function, called from inside an observer callback where nothing can catch it -- still leaves the
		// observer disconnected and the timer cleared.
		stop();
		run();
	});

	observer.observe(doc.documentElement, { childList: true, subtree: true });
	timer = setTimeout(expire, timeoutMs);

	// Without this the waiter survives its own teardown: disposeAll would leave the observer connected and
	// the callback would fire into a page the plugin has already been switched off on.
	registerDisposer(stop);
}
