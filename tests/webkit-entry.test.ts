import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { disposeAll } from '../webkit/lifecycle';
import { isProfilePath, isSteamCommunityHost, waitForElement } from '../webkit/routing';

/**
 * The entry point's testable half.
 *
 * WebkitMain imports @steambrew/webkit, which exists only inside the Steam client, so the entry itself is
 * verified by hand against a live client. Everything in it that carries a decision was pulled out into
 * webkit/routing.ts, which imports nothing but the disposer registry -- that split is the whole reason the
 * module exists, and anything this file cannot reach is a sign more should have moved into it.
 */

/**
 * happy-dom queues MutationObserver callbacks as macrotasks, so a microtask flush -- await
 * Promise.resolve(), or just asserting on the next line -- lands strictly before the observer has run.
 * Same helper and same reason as tests/webkit-inject-friendblocks.test.ts.
 */
const macrotask = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 20));

beforeEach(() => {
	disposeAll();
	document.body.innerHTML = '';
});

/**
 * disposeAll again, because a waiter a test left mid-wait holds an observer on the shared document and
 * would fire its callback into the next test's fixture. Timers are handed back to the real
 * implementation for the same kind of reason: the cleanup cases below fake them.
 */
afterEach(() => {
	disposeAll();
	vi.useRealTimers();
	vi.restoreAllMocks();
});

describe('isSteamCommunityHost', () => {
	it('accepts the community host and its subdomains', () => {
		expect(isSteamCommunityHost('steamcommunity.com')).toBe(true);
		expect(isSteamCommunityHost('www.steamcommunity.com')).toBe(true);
	});

	/**
	 * This guard decides whether the bundle touches the page at all, so the cases worth pinning are the
	 * hosts that look like the real one without being it, and each of these fails a different way.
	 *
	 * store.steampowered.com is a genuine Steam host the plugin has no business on. evil-steamcommunity.com
	 * is the boundary the leading `(^|\.)` enforces: `hostname.includes('steamcommunity.com')`, or any
	 * pattern anchored only on the right, accepts it. steamcommunity.com.evil.net is the boundary the
	 * trailing `$` enforces, and anything that merely looks for the string somewhere accepts it.
	 * www.steamcommunity.com.evil.net is here because dropping only the `$` still rejects the other two,
	 * so without this line that mutation survives.
	 */
	it('rejects other Steam hosts and lookalikes', () => {
		expect(isSteamCommunityHost('store.steampowered.com')).toBe(false);
		expect(isSteamCommunityHost('evil-steamcommunity.com')).toBe(false);
		expect(isSteamCommunityHost('steamcommunity.com.evil.net')).toBe(false);
		expect(isSteamCommunityHost('www.steamcommunity.com.evil.net')).toBe(false);
		expect(isSteamCommunityHost('notsteamcommunity.com')).toBe(false);
		expect(isSteamCommunityHost('')).toBe(false);
	});
});

describe('isProfilePath', () => {
	it('accepts profile paths', () => {
		expect(isProfilePath('/profiles/76561198145891996/')).toBe(true);
		expect(isProfilePath('/id/intkira/')).toBe(true);
		// Steam serves the profile with and without the trailing slash, and only one of those two is ever
		// what location.pathname holds.
		expect(isProfilePath('/id/intkira')).toBe(true);
	});

	/**
	 * A deliberate false positive, pinned so that tightening the pattern to `$` has to be a decision
	 * rather than a tidy-up.
	 *
	 * /id/{vanity}/games/ and its siblings are still that account's profile, and whether Steam renders
	 * .profile_rightcol on any of them cannot be settled from here. Accepting them costs one waitForElement
	 * that finds nothing and expires; rejecting them would silently drop the button from any sub-page that
	 * does render the column. The path guard's job is "plausibly a profile", and the column itself is the
	 * real gate.
	 */
	it('accepts a profile sub-page', () => {
		expect(isProfilePath('/id/intkira/games/')).toBe(true);
	});

	/**
	 * /friends/ is the interesting one: friend rows live there, and this returning false is what pins the
	 * design that the friend-block injector is not gated on this guard.
	 *
	 * /idols/example catches a pattern that drops the separator after the group -- `id` matches as a prefix
	 * of the first segment and the whole page is treated as a profile. /profiles/ with nothing after it
	 * catches `[^/]+` weakened to `[^/]*`, which would send the injector at a page with no account on it.
	 */
	it('rejects non-profile paths', () => {
		expect(isProfilePath('/')).toBe(false);
		expect(isProfilePath('/groups/example')).toBe(false);
		expect(isProfilePath('/market/')).toBe(false);
		expect(isProfilePath('/friends/')).toBe(false);
		expect(isProfilePath('/idols/example')).toBe(false);
		expect(isProfilePath('/profiles/')).toBe(false);
	});
});

describe('waitForElement', () => {
	it('runs immediately when the element is already present', () => {
		document.body.innerHTML = '<div class="target"></div>';
		const run = vi.fn();
		waitForElement(document, '.target', run);
		expect(run).toHaveBeenCalledOnce();
	});

	it('runs once the element appears', async () => {
		const run = vi.fn();
		waitForElement(document, '.target', run);
		expect(run).not.toHaveBeenCalled();

		document.body.innerHTML = '<div class="target"></div>';
		await macrotask();
		expect(run).toHaveBeenCalledOnce();
	});

	/**
	 * The spy is doing two jobs. It keeps the output pristine, since expiry is the one path that logs, and it
	 * is the assertion for that log: expiry was the only silent failure left in the bundle, and a mistyped or
	 * renamed selector otherwise produces no button, no error and no output at all -- indistinguishable from
	 * the user having switched the feature off. The selector and the elapsed time are both in the message
	 * because either one alone leaves the reader guessing which waiter it was.
	 */
	it('gives up after the timeout, never runs, and says so', async () => {
		const warned = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const run = vi.fn();
		waitForElement(document, '.target', run, 10);
		await macrotask();

		document.body.innerHTML = '<div class="target"></div>';
		await macrotask();
		expect(run).not.toHaveBeenCalled();
		expect(warned).toHaveBeenCalledOnce();
		expect(warned.mock.calls[0][0]).toContain('.target');
		expect(warned.mock.calls[0][0]).toContain('10');
	});

	// The two quiet exits, asserted as quiet. Only giving up is worth a line: a waiter that found what it
	// wanted has nothing to report, and one torn down with its page is not a failure at all -- logging either
	// would put a warning in the console of every profile page the plugin works correctly on.
	it('says nothing when it finds the element', async () => {
		const warned = vi.spyOn(console, 'warn').mockImplementation(() => {});
		waitForElement(document, '.target', vi.fn(), 10);

		document.body.innerHTML = '<div class="target"></div>';
		await macrotask();
		expect(warned).not.toHaveBeenCalled();
	});

	it('stops waiting once disposed, and says nothing', async () => {
		const warned = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const run = vi.fn();
		waitForElement(document, '.target', run, 10);
		disposeAll();

		document.body.innerHTML = '<div class="target"></div>';
		await macrotask();
		await macrotask();
		expect(run).not.toHaveBeenCalled();
		expect(warned).not.toHaveBeenCalled();
	});

	/**
	 * Two further mutation batches after the match, because one is not enough to catch anything: a single
	 * innerHTML assignment wakes the observer once, so a waiter that never stops still reports exactly one
	 * call. The callback has to be treated as a one-shot -- the profile injector happens to be idempotent,
	 * but "run as soon as the selector matches" promises once, and every later firing is a full-document
	 * querySelector on a page that is done with us.
	 */
	it('runs the callback once however many times the page mutates afterwards', async () => {
		const run = vi.fn();
		waitForElement(document, '.target', run);

		document.body.innerHTML = '<div class="target"></div>';
		await macrotask();
		expect(run).toHaveBeenCalledOnce();

		document.body.appendChild(document.createElement('span'));
		await macrotask();
		document.body.appendChild(document.createElement('span'));
		await macrotask();

		expect(run).toHaveBeenCalledOnce();
	});
});

/**
 * The store review rejects a plugin that leaves a MutationObserver connected or a timer pending, and this
 * function starts one of each. None of that is visible through the callback: the `settled` flag makes a
 * surviving timer and a still-connected observer behave exactly like a cleaned-up one, so every test above
 * passes with both leaked. These four cover the three exit paths -- matched, expired, disposed -- plus the
 * path that must arm nothing at all, and they are the only tests here that can fail on a leak.
 */
describe('waitForElement cleanup', () => {
	it('arms nothing when the element is already present', () => {
		document.body.innerHTML = '<div class="target"></div>';
		vi.useFakeTimers();

		const run = vi.fn();
		waitForElement(document, '.target', run);

		expect(run).toHaveBeenCalledOnce();
		expect(vi.getTimerCount()).toBe(0);
	});

	it('clears its timer and disconnects once the element appears', async () => {
		const disconnected = vi.spyOn(MutationObserver.prototype, 'disconnect');
		vi.useFakeTimers();

		const run = vi.fn();
		waitForElement(document, '.target', run);
		expect(vi.getTimerCount()).toBe(1);

		document.body.innerHTML = '<div class="target"></div>';
		// Far short of the 15s default, so a timer still pending here is one nothing cleared.
		await vi.advanceTimersByTimeAsync(50);

		expect(run).toHaveBeenCalledOnce();
		expect(vi.getTimerCount()).toBe(0);
		expect(disconnected).toHaveBeenCalledOnce();
	});

	// The timeout path has no timer left to check -- the one that fired is gone by definition -- so the
	// observer is the whole assertion, and it is invisible to the give-up test above. console.warn is
	// silenced rather than asserted here; that message has its own test.
	it('disconnects when it gives up', async () => {
		vi.spyOn(console, 'warn').mockImplementation(() => {});
		const disconnected = vi.spyOn(MutationObserver.prototype, 'disconnect');

		waitForElement(document, '.target', vi.fn(), 10);
		await macrotask();

		expect(disconnected).toHaveBeenCalledOnce();
	});

	it('clears its timer and disconnects when disposed mid-wait', () => {
		const disconnected = vi.spyOn(MutationObserver.prototype, 'disconnect');
		vi.useFakeTimers();

		waitForElement(document, '.target', vi.fn());
		expect(vi.getTimerCount()).toBe(1);

		disposeAll();

		expect(vi.getTimerCount()).toBe(0);
		expect(disconnected).toHaveBeenCalledOnce();
	});
});
