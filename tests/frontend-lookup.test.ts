import { describe, expect, it, vi } from 'vitest';
import {
	LOOKUP_HINT,
	LOOKUP_MESSAGES,
	LOOKUP_TIMEOUT_MS,
	currentUserResult,
	normalizeSteamId,
	readCurrentUserSteamId,
	resolveLookupTarget,
} from '../frontend/services/lookup';

const ID = '76561198145891996';

/** A resolver that must not be reached. Its call count is the assertion. */
const unusedResolver = () => vi.fn(async () => ID);

/** The shape getCurrentUserSteamId reads, built around one strSteamID value. */
const userWindow = (strSteamID: unknown) => ({ App: { m_CurrentUser: { strSteamID } } });

describe('normalizeSteamId', () => {
	it('accepts a well-formed SteamID64', () => {
		expect(normalizeSteamId(ID)).toBe(ID);
	});

	/**
	 * The empty string is the backend's answer to every failure -- a malformed vanity, an unreachable
	 * Steam, a non-200 response, a profile that does not exist -- so it is the single most likely value
	 * this function will ever be handed. Accepting it would put '' into a CS2Tracker URL and open a
	 * stats page for nobody.
	 */
	it('rejects the empty answer the backend returns on every failure', () => {
		expect(normalizeSteamId('')).toBeNull();
		expect(normalizeSteamId('   ')).toBeNull();
	});

	// A truncated or overlong id is what a partial read or a concatenated payload looks like, and 16 of
	// the 17 digits of a real id is a syntactically plausible number that belongs to nobody.
	it('rejects a wrong-length id', () => {
		expect(normalizeSteamId(ID.slice(0, 16))).toBeNull();
		expect(normalizeSteamId(`${ID}0`)).toBeNull();
	});

	// 17 digits is not enough: the individual-account interval starts above 76561197960265728.
	it('rejects a 17-digit value outside the individual-account range', () => {
		expect(normalizeSteamId('12345678901234567')).toBeNull();
		expect(normalizeSteamId('00000000000000000')).toBeNull();
	});

	/**
	 * The number is the case that matters. 76561198145891996 is past 2^53, where representable doubles
	 * are 16 apart, so it arrives back as 76561198145892000 -- a well-formed SteamID64 belonging to
	 * somebody else. Coercing instead of rejecting would silently open a stranger's stats page.
	 */
	it('rejects a value that is not a string, including a numeric id', () => {
		for (const value of [undefined, null, 76561198145891996, true, {}, [ID], () => ID]) {
			expect(normalizeSteamId(value)).toBeNull();
		}
	});

	it('trims what it accepts rather than rejecting it', () => {
		expect(normalizeSteamId(` ${ID}\n`)).toBe(ID);
	});
});

describe('resolveLookupTarget', () => {
	it('answers a SteamID64 without asking the backend', async () => {
		const resolve = unusedResolver();

		await expect(resolveLookupTarget(ID, resolve)).resolves.toEqual({ kind: 'found', steamId64: ID });
		expect(resolve).not.toHaveBeenCalled();
	});

	it('answers a full profile URL without asking the backend', async () => {
		const resolve = unusedResolver();

		await expect(resolveLookupTarget(`https://steamcommunity.com/profiles/${ID}/`, resolve)).resolves.toEqual({
			kind: 'found',
			steamId64: ID,
		});
		expect(resolve).not.toHaveBeenCalled();
	});

	// The backend is handed the vanity segment, not the URL the user pasted: it validates its argument
	// against a strict character class, so a URL would be rejected before any lookup happened.
	it('resolves a vanity name and a vanity URL through the backend', async () => {
		const resolve = vi.fn(async () => ID);

		await expect(resolveLookupTarget('gaben', resolve)).resolves.toEqual({ kind: 'found', steamId64: ID });
		await expect(resolveLookupTarget('https://steamcommunity.com/id/gaben/', resolve)).resolves.toEqual({
			kind: 'found',
			steamId64: ID,
		});

		expect(resolve).toHaveBeenCalledTimes(2);
		expect(resolve).toHaveBeenNthCalledWith(1, 'gaben');
		expect(resolve).toHaveBeenNthCalledWith(2, 'gaben');
	});

	/**
	 * The distinction this whole result type exists for. The backend returns "" for a vanity that does
	 * not exist and for a vanity lookup that failed, and it has already logged the difference on the Lua
	 * side. To the user the actionable reading is "check the name", so an empty answer is a miss and not
	 * an error.
	 */
	it('reports a not-found for the empty answer', async () => {
		await expect(resolveLookupTarget('gaben', async () => '')).resolves.toEqual({
			kind: 'error',
			message: LOOKUP_MESSAGES.notFound,
		});
	});

	// Anything the channel carries that is not a usable id reads the same way to the user as a name that
	// does not exist. The values below are what a wrong-typed or half-written payload looks like.
	it('reports a not-found for an answer that is not a usable id', async () => {
		for (const answer of [undefined, null, '0', 'null', '76561198145891', 76561198145891996]) {
			await expect(resolveLookupTarget('gaben', async () => answer)).resolves.toEqual({
				kind: 'error',
				message: LOOKUP_MESSAGES.notFound,
			});
		}
	});

	// Input the parser cannot classify never reaches the IPC channel: there is nothing to look up, and
	// the message has to name the input rather than blame the network.
	it('rejects unparseable input without asking the backend', async () => {
		const resolve = unusedResolver();

		for (const raw of ['', '   ', 'x', 'not a steam id!', 'https://example.com/id/gaben']) {
			await expect(resolveLookupTarget(raw, resolve)).resolves.toEqual({
				kind: 'error',
				message: LOOKUP_MESSAGES.unparseable,
			});
		}
		expect(resolve).not.toHaveBeenCalled();
	});

	/**
	 * A rejection is the IPC channel failing, which is not the same fault as a name that does not exist
	 * and must not be reported as one: the user would go and check a spelling that was never the problem.
	 */
	it('reports a rejected call as a failed lookup, not a missing profile', async () => {
		await expect(resolveLookupTarget('gaben', async () => Promise.reject(new Error('no backend')))).resolves.toEqual({
			kind: 'error',
			message: LOOKUP_MESSAGES.lookupFailed,
		});
	});

	// The resolver is Millennium's injected implementation rather than the stub this repo compiles
	// against, so its declared type is evidence of intent and not of behaviour. A synchronous throw
	// would otherwise escape into a React event handler.
	it('reports a synchronous throw as a failed lookup', async () => {
		await expect(
			resolveLookupTarget('gaben', () => {
				throw new Error('not connected');
			}),
		).resolves.toEqual({ kind: 'error', message: LOOKUP_MESSAGES.lookupFailed });
	});

	// Same reasoning from the other side: a resolver that answers without a promise is still an answer.
	it('accepts a resolver that answers without a promise', async () => {
		const resolve = (() => ID) as unknown as (vanity: string) => Promise<unknown>;

		await expect(resolveLookupTarget('gaben', resolve)).resolves.toEqual({ kind: 'found', steamId64: ID });
	});

	// The hook is the only place a failed lookup can be written down, and the original error is the whole
	// value of it.
	it('reports a fault through the hook once, with the original error', async () => {
		const boom = new Error('channel closed');
		const onFailure = vi.fn();

		await resolveLookupTarget('gaben', async () => Promise.reject(boom), onFailure);

		expect(onFailure).toHaveBeenCalledTimes(1);
		expect(onFailure).toHaveBeenCalledWith(boom);
	});

	/**
	 * A missing profile is a normal outcome, not a fault, and a hook that fired for it would train its
	 * reader to ignore it -- the same rule parseSettings' onProblem follows for an empty config.
	 */
	it('does not report a not-found through the hook', async () => {
		const onFailure = vi.fn();

		await resolveLookupTarget('gaben', async () => '', onFailure);
		await resolveLookupTarget('!!!', async () => '', onFailure);

		expect(onFailure).not.toHaveBeenCalled();
	});

	/**
	 * The liveness case, and the one a try/catch cannot cover: a call that neither resolves nor rejects.
	 * Without the race the await never returns, the panel's busy flag is never cleared, and both buttons
	 * stay disabled for the lifetime of the panel -- a hang is the one failure the user cannot retry out
	 * of. A never-settling promise is exactly what an IPC channel that dropped the response looks like.
	 */
	it('gives up on a backend that never answers', async () => {
		await expect(resolveLookupTarget('gaben', () => new Promise(() => {}), undefined, 5)).resolves.toEqual({
			kind: 'error',
			message: LOOKUP_MESSAGES.timedOut,
		});
	});

	// A hang is a fault, not a misspelt name, so it is written down like the other faults -- and the log
	// line is the only place the duration is ever stated.
	it('reports a timeout through the hook', async () => {
		const onFailure = vi.fn();

		await resolveLookupTarget('gaben', () => new Promise(() => {}), onFailure, 5);

		expect(onFailure).toHaveBeenCalledTimes(1);
		expect(onFailure.mock.calls[0][0]).toBeInstanceOf(Error);
		expect((onFailure.mock.calls[0][0] as Error).message).toMatch(/5ms/);
	});

	// The other half of the race: a backend that answers, slowly but in time, must still win. Inverting
	// the race or racing against zero would fail here and nowhere else.
	it('waits for a slow answer that arrives before the deadline', async () => {
		const resolve = () => new Promise<string>((done) => setTimeout(() => done(ID), 5));

		await expect(resolveLookupTarget('gaben', resolve, undefined, 500)).resolves.toEqual({
			kind: 'found',
			steamId64: ID,
		});
	});

	/**
	 * The timer is cleared once the answer arrives, so a resolved lookup leaves nothing pending. Without
	 * this, every lookup in a session parks a fifteen-second timer -- which is also the thing that keeps a
	 * test runner alive past the end of the test that started it.
	 */
	it('leaves no timer running once the backend answers', async () => {
		vi.useFakeTimers();
		try {
			await expect(resolveLookupTarget('gaben', async () => ID)).resolves.toEqual({ kind: 'found', steamId64: ID });
			expect(vi.getTimerCount()).toBe(0);
		} finally {
			vi.useRealTimers();
		}
	});

	// A diagnostic must never change the answer, and here a throw from it would become the unhandled
	// rejection the try/catch exists to prevent.
	it('survives a hook that throws', async () => {
		const onFailure = vi.fn(() => {
			throw new Error('the logger is broken too');
		});

		await expect(
			resolveLookupTarget('gaben', async () => Promise.reject(new Error('rejected')), onFailure),
		).resolves.toEqual({ kind: 'error', message: LOOKUP_MESSAGES.lookupFailed });
		expect(onFailure).toHaveBeenCalledTimes(1);
	});
});

describe('readCurrentUserSteamId', () => {
	it('reads the signed-in user id', () => {
		expect(readCurrentUserSteamId(userWindow(ID))).toBe(ID);
	});

	/**
	 * Steam populates App.m_CurrentUser during startup, so every step of the path can be missing when the
	 * panel mounts early. None of these is an error; all of them mean "not yet".
	 */
	it('answers null while Steam has not populated the path yet', () => {
		for (const win of [
			undefined,
			null,
			'',
			42,
			{},
			{ App: undefined },
			{ App: null },
			{ App: {} },
			{ App: { m_CurrentUser: null } },
			{ App: { m_CurrentUser: {} } },
			userWindow(undefined),
		]) {
			expect(readCurrentUserSteamId(win)).toBeNull();
		}
	});

	// The one value that must never be trusted: a plausible-looking id that is not one. It would open a
	// stats page for an account that does not exist, or worse, for a real account that is not the user's.
	it('rejects a wrong-length or out-of-range id', () => {
		expect(readCurrentUserSteamId(userWindow(ID.slice(0, 16)))).toBeNull();
		expect(readCurrentUserSteamId(userWindow(`${ID}0`))).toBeNull();
		expect(readCurrentUserSteamId(userWindow('12345678901234567'))).toBeNull();
		expect(readCurrentUserSteamId(userWindow('0'))).toBeNull();
		expect(readCurrentUserSteamId(userWindow(''))).toBeNull();
	});

	// strSteamID is a string in every Steam build seen, but it is read off an object this code does not
	// own, and a numeric id cannot survive the round trip -- see normalizeSteamId.
	it('rejects a numeric strSteamID rather than coercing it', () => {
		expect(readCurrentUserSteamId(userWindow(76561198145891996))).toBeNull();
	});
});

describe('currentUserResult', () => {
	it('answers the signed-in user id', () => {
		expect(currentUserResult(userWindow(ID))).toEqual({ kind: 'found', steamId64: ID });
	});

	// Its own message, and not the lookup ones: nothing the user typed is wrong and retyping it cannot
	// help, so this has to read as "wait a moment" rather than "check the name".
	it('answers the not-signed-in-yet message when the id is missing', () => {
		expect(currentUserResult({})).toEqual({ kind: 'error', message: LOOKUP_MESSAGES.noCurrentUser });
	});
});

describe('LOOKUP_MESSAGES', () => {
	// Four causes, four sentences. Two identical ones would make the panel unable to tell the user which
	// of them happened, which is the only reason these are separate constants.
	it('gives every failure its own wording', () => {
		const messages = Object.values(LOOKUP_MESSAGES);
		expect(new Set(messages).size).toBe(messages.length);
		expect(messages.every((message) => message.trim().length > 0)).toBe(true);
	});

	/**
	 * Each message pinned to the cause it belongs to. Without this, two of them could trade places and
	 * every behavioural test above would still pass while the panel told the user to check a spelling
	 * after the IPC channel had died.
	 */
	it('names the cause each failure actually has', () => {
		expect(LOOKUP_MESSAGES.unparseable).toMatch(/does not look like/i);
		expect(LOOKUP_MESSAGES.notFound).toMatch(/no steam profile/i);
		expect(LOOKUP_MESSAGES.lookupFailed).toMatch(/could not reach steam/i);
		expect(LOOKUP_MESSAGES.timedOut).toMatch(/did not answer/i);
		expect(LOOKUP_MESSAGES.noCurrentUser).toMatch(/not available yet/i);
	});

	// The hint is the field's resting state; a failure message showing there would be alarming, and the
	// unparseable message showing as the hint would tell a user who has typed nothing that they are wrong.
	it('keeps the resting hint distinct from every failure', () => {
		expect(LOOKUP_HINT).toMatch(/steamid64/i);
		expect(Object.values(LOOKUP_MESSAGES)).not.toContain(LOOKUP_HINT);
	});
});

describe('LOOKUP_TIMEOUT_MS', () => {
	/**
	 * It has to outlast the backend's own HTTP timeout, which backend/main.lua sets to 10 seconds. Give up
	 * sooner and the panel would report "Steam did not answer" while the backend was still inside a request
	 * that was about to succeed -- and the retry the message invites would start the same ten seconds again.
	 *
	 * The upper bound is a patience limit rather than a protocol one: past about half a minute a user has
	 * concluded the plugin is broken, so there is no point waiting longer than they will.
	 */
	it('outlasts the backend HTTP timeout it is waiting on', () => {
		expect(LOOKUP_TIMEOUT_MS).toBeGreaterThan(10_000);
		expect(LOOKUP_TIMEOUT_MS).toBeLessThanOrEqual(30_000);
	});
});
