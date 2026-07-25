import { isSteamId64, parseLookupInput } from '../../shared/steamid';

/**
 * Every decision the player lookup makes, in a module that imports nothing from Steam.
 *
 * Its own file for the reason frontend/services/setting-value.ts is its own file: the panel and its
 * services sit behind @steambrew/client, which cannot be loaded outside the Steam client -- see
 * frontend/services/settings.ts for why -- so anything sharing a module with that import is untestable
 * by construction. What is left next door in frontend/services/steamid.ts is the IPC binding, one
 * window read, one SteamClient call and a console line, and none of them decides anything.
 *
 * The window shape is a parameter rather than a global read for the same reason: it is the difference
 * between a function a test can hand eleven half-initialised Steam startups and a function that can
 * only be run inside Steam.
 */

/**
 * What the lookup field says when nothing has gone wrong.
 *
 * It carries the worked example that would otherwise be a placeholder: Steam's TextField declares no
 * placeholder prop, and the description slot is the one place an example can go that is also read out by
 * a screen reader and still visible once the user has started typing.
 */
export const LOOKUP_HINT =
	'Accepts a SteamID64 such as 76561198145891996, a full profile URL, or a custom URL name.';

/**
 * One sentence per way a lookup can fail, and they are separate constants because the user's next move
 * differs for each. Grouped here rather than written at the four `return` sites so that the wording is
 * covered by tests -- the components that display it cannot be.
 *
 * notFound and lookupFailed are the pair worth being careful about. The backend answers "" for a vanity
 * that does not exist *and* for a lookup that could not be made, having already logged which on the Lua
 * side, so this module only ever sees the empty string; a rejection, by contrast, means the IPC channel
 * itself failed. Telling a user to check a spelling when Steam was unreachable sends them to fix
 * something that was never wrong.
 */
export const LOOKUP_MESSAGES = {
	unparseable: 'That does not look like a SteamID64, a profile URL, or a custom URL name.',
	notFound: 'No Steam profile matches that name. Check the spelling, or paste the profile URL instead.',
	lookupFailed: 'Could not reach Steam to look that name up. Check your connection and try again.',
	noCurrentUser: 'Your own Steam ID is not available yet. Try again in a moment.',
} as const;

/**
 * The outcome of one lookup: an id to open, or a sentence to show under the field.
 *
 * A `string | null` return would be smaller and would lose the only thing the user needs, which is
 * which of the four failures happened. Choosing the sentence here rather than in the component is what
 * puts that choice inside the test suite.
 */
export type LookupResult = { kind: 'found'; steamId64: string } | { kind: 'error'; message: string };

/**
 * The one definition of a usable SteamID64 answer in this module, applied to every id that arrives from
 * outside it: the backend's vanity resolution, and Steam's own current-user object.
 *
 * `unknown` is the honest parameter type in both cases. The IPC helper is `callable<Args, T>` with `T` a
 * free type parameter cast straight onto `Promise<T>`, so declaring that channel `string` is an
 * assertion nothing checks; App.m_CurrentUser is an object this plugin does not own and does not
 * version.
 *
 * A non-string is rejected rather than coerced, and the number is the case that makes it matter:
 * 76561198145891996 is past 2^53, where representable doubles are 16 apart, so `String(id)` yields
 * 76561198145892000 -- a well-formed SteamID64 belonging to a different real account. Coercion here
 * would open a stranger's stats page and look like it had worked.
 *
 * isSteamId64 rather than a length test, because '' is the backend's answer to every failure and
 * '00000000000000000' is 17 digits of nobody. The range check is the only test that rejects both.
 */
export function normalizeSteamId(value: unknown): string | null {
	if (typeof value !== 'string') return null;
	const trimmed = value.trim();
	return isSteamId64(trimmed) ? trimmed : null;
}

/**
 * Report a fault without letting it change the answer -- the same contract as report() in
 * shared/settings.ts and fail() in frontend/services/setting-value.ts. A throw from the hook would
 * become the unhandled rejection the try/catch below exists to prevent.
 */
function report(onFailure: ((error: unknown) => void) | undefined, error: unknown): void {
	try {
		onFailure?.(error);
	} catch {
		/* a diagnostic must never change the answer */
	}
}

/**
 * Turn what the user typed into either an id to open or a sentence explaining why not. Total: every
 * input and every backend answer produces a LookupResult, and nothing here throws.
 *
 * resolveVanity is a parameter, not an import, and that is the whole extraction. It is
 * `callable('ResolveVanity')` in frontend/services/steamid.ts, which cannot be imported by a test; as a
 * parameter it is a two-line stub, so every branch below is reachable from tests/frontend-lookup.test.ts.
 * It takes the bare vanity rather than the RPC's `{ vanity }` argument object so that the IPC channel's
 * calling convention stays on the Steam side of this boundary.
 *
 * Unparseable input never reaches the channel. There is nothing to look up, the backend would reject it
 * against its own character class anyway, and the message has to name the input instead of blaming the
 * network.
 *
 * Everything from the call onwards is inside the try, including the call itself: a rejection is the
 * documented failure, but the implementation behind resolveVanity is injected by the Millennium runtime
 * rather than the stub this repo compiles against, so a synchronous throw has to answer the same way.
 * `await` covers the third shape -- a resolver that answers without a promise -- at no cost to the
 * ordinary path.
 *
 * onFailure fires only for a fault, never for a profile that simply does not exist. That distinction is
 * the entire value of it: a hook that also fired for a misspelt name would train its reader to ignore
 * it, which is the rule parseSettings' onProblem follows for an empty config.
 */
export async function resolveLookupTarget(
	raw: string,
	resolveVanity: (vanity: string) => Promise<unknown>,
	onFailure?: (error: unknown) => void,
): Promise<LookupResult> {
	const target = parseLookupInput(raw);
	if (target.kind === 'invalid') return { kind: 'error', message: LOOKUP_MESSAGES.unparseable };

	if (target.kind === 'steamid64') {
		// Already range-checked inside parseLookupInput. Re-checked through the same normaliser the
		// backend's answer goes through, so this function's postcondition -- a `found` result always
		// carries a well-formed SteamID64 -- is stated here rather than inherited from another module.
		const steamId64 = normalizeSteamId(target.value);
		return steamId64 ? { kind: 'found', steamId64 } : { kind: 'error', message: LOOKUP_MESSAGES.unparseable };
	}

	let answer: unknown;
	try {
		answer = await resolveVanity(target.value);
	} catch (error) {
		report(onFailure, error);
		return { kind: 'error', message: LOOKUP_MESSAGES.lookupFailed };
	}

	const steamId64 = normalizeSteamId(answer);
	return steamId64 ? { kind: 'found', steamId64 } : { kind: 'error', message: LOOKUP_MESSAGES.notFound };
}

/**
 * The signed-in user's SteamID64 out of Steam's App object, or null when it is not there yet.
 *
 * Optional at every step because Steam populates m_CurrentUser during startup, and the panel can mount
 * before it has: a missing App, a missing m_CurrentUser and a missing strSteamID all mean "not yet",
 * which is a state to wait out rather than an error to report.
 *
 * This is the viewer, and it is only ever the answer to a question about the viewer. It must never
 * become a fallback for a lookup -- resolveLookupTarget cannot reach it, by signature -- because the
 * failure would hide: the user's own profile would look correct while every other lookup silently
 * returned their own stats. The webkit side spent two fix rounds removing exactly that bug.
 */
export function readCurrentUserSteamId(win: unknown): string | null {
	const app = (win as { App?: { m_CurrentUser?: { strSteamID?: unknown } } } | null | undefined)?.App;
	return normalizeSteamId(app?.m_CurrentUser?.strSteamID);
}

/**
 * The same read as a LookupResult, so the panel has one shape and one branch to handle for both of its
 * buttons -- and so that the choice of message for a missing id is made here, where it is tested,
 * rather than in the component, where it is not.
 *
 * Its own message rather than one of the lookup ones: nothing the user typed is wrong, and retyping it
 * cannot help.
 */
export function currentUserResult(win: unknown): LookupResult {
	const steamId64 = readCurrentUserSteamId(win);
	return steamId64 ? { kind: 'found', steamId64 } : { kind: 'error', message: LOOKUP_MESSAGES.noCurrentUser };
}
