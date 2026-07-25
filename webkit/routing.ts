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
 * Generous on purpose. It is not a deadline the user notices -- nothing is waiting on it and expiring is
 * silent -- it is the point at which an observer watching the whole document stops being worth its cost on
 * a page that was never going to render the element. A community page that has not laid out its sidebar
 * within fifteen seconds is a page where Steam, not this plugin, is the thing that is slow.
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
	 * `timer` is read rather than closed over as a constant because stop() is reachable before the
	 * assignment below -- observe() can deliver a batch synchronously enough that the callback runs first
	 * -- and clearing `undefined` has to be the no-op rather than a crash.
	 */
	const stop = () => {
		if (settled) return;
		settled = true;
		observer.disconnect();
		if (timer !== undefined) clearTimeout(timer);
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
	timer = setTimeout(stop, timeoutMs);

	// Without this the waiter survives its own teardown: disposeAll would leave the observer connected and
	// the callback would fire into a page the plugin has already been switched off on.
	registerDisposer(stop);
}
