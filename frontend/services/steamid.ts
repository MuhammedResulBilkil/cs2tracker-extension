import { callable } from '@steambrew/client';
import { buildSteamUrlCommand } from '../../shared/cs2tracker';
import { currentUserResult, resolveLookupTarget, type LookupResult } from './lookup';

/**
 * The only module in the frontend bundle that reaches the backend, the window, or SteamClient.
 *
 * That is why it has no test, and the reason is the same one frontend/services/settings.ts documents at
 * length: @steambrew/client re-exports its modules extensionlessly, so Node's ESM resolver rejects it
 * before any code runs, and if it resolved it would initialise against window.webpackChunksteamui --
 * a global only the Steam client defines.
 *
 * So nothing here decides anything. Every branch lives in ./lookup.ts, which imports nothing from Steam
 * and is covered by tests/frontend-lookup.test.ts: what counts as a usable SteamID64, which of the four
 * sentences a failure gets, and how to read the current user off an object of unknown shape. What is
 * left below is one IPC binding, one argument adaptor, one window read, one console line, and one
 * SteamClient call.
 */

/**
 * Bound once at module load, which is what Millennium's bundler expects rather than merely what its
 * examples do. Its AST pass rewrites this call site to inject the plugin name -- `client.callable` in
 * the rendered chunk becomes `client.callable(pluginName,"ResolveVanity")` -- and it matches on the
 * callee's member path, so the binding cannot be aliased, wrapped, or deferred without silently losing
 * that first argument and calling into a plugin named "ResolveVanity". webkit/settings.ts carries the
 * same warning for the same reason.
 *
 * Declared `string` where webkit/settings.ts declares `unknown`, and the difference is the package
 * rather than the intent: this callable constrains its return to `Return extends IPCType`, which
 * `unknown` does not satisfy, so the honest type is not available here. The declaration is therefore an
 * unchecked claim about a channel that carries whatever the runtime put on it -- which is exactly why
 * normalizeSteamId, on the other side of resolveLookupTarget, takes `unknown` and validates rather than
 * trusting this signature.
 *
 * The argument is an object because Millennium's IPC passes named parameters: `{ vanity }` here arrives
 * as the `vanity` parameter of ResolveVanity in backend/main.lua.
 */
const resolveVanityRpc = callable<[{ vanity: string }], string>('ResolveVanity');

/**
 * The one member of SteamClient.URL this plugin calls, declared here because the published typings put it
 * out of reach rather than because they disagree about it.
 *
 * @steambrew/client types the client surface as `URL: URL` in a module that neither imports nor
 * re-exports its own ./URL declaration, so that annotation resolves to the DOM's URL class -- on which
 * ExecuteSteamURL does not exist -- and the interface that does declare it is not reachable from the
 * package's public surface to import. The signature below is copied from that unreachable declaration
 * (globals/steam-client/URL.d.ts: `ExecuteSteamURL(url: string): void`), so the call is still checked
 * against a real signature instead of being waved through as `any`. Drop this the moment the package
 * exports its own.
 */
interface SteamUrlApi {
	ExecuteSteamURL(url: string): void;
}

/**
 * Turn what the user typed into a profile to open, or a sentence saying why not.
 *
 * Widened from the `Promise<string | null>` the plan sketched, because null cannot say which of three
 * things went wrong -- unparseable input, a name that does not exist, an IPC channel that failed -- and
 * the panel has to tell the user which. The choice of sentence is resolveLookupTarget's, where it is
 * tested; this function only supplies the two things a test cannot: the RPC and the console.
 */
export function resolveLookupInput(raw: string): Promise<LookupResult> {
	return resolveLookupTarget(
		raw,
		(vanity) => resolveVanityRpc({ vanity }),
		(error) => {
			console.error('[CS2Tracker] Vanity resolution failed:', error);
		},
	);
}

/**
 * The signed-in user's profile, for the panel's "My profile" button and nothing else.
 *
 * window is read here and passed in rather than reached for inside readCurrentUserSteamId, which is what
 * lets tests hand that function every half-initialised shape Steam's startup can produce.
 *
 * This is the viewer. It must never stand in for a failed lookup: the failure would hide, because the
 * user's own profile would still look right while every other lookup quietly returned their own stats.
 * resolveLookupInput cannot reach it -- resolveLookupTarget takes no window -- and that is by design.
 */
export function getCurrentUserProfile(): LookupResult {
	return currentUserResult(window);
}

/**
 * Hand the profile URL to Steam, which routes it to the built-in browser or the system one.
 *
 * ExecuteSteamURL and not window.open: this runs inside the Steam client's own UI, where window.open
 * either does nothing or opens a chrome-less popup with no navigation, and where the openurl_external
 * form -- the whole point of the openExternal setting -- is a steam:// command only Steam can carry out.
 *
 * The cast is the workaround SteamUrlApi above documents: SteamClient.URL is declared as the DOM's URL
 * class, which shares no members with the API it actually is, so `unknown` is the required intermediate
 * step. Cast at the call rather than at module load, so nothing captures SteamClient before Steam has
 * built it.
 */
export function openCs2TrackerProfile(steamId64: string, openExternal: boolean): void {
	const steamUrlApi = SteamClient.URL as unknown as SteamUrlApi;
	steamUrlApi.ExecuteSteamURL(buildSteamUrlCommand(steamId64, openExternal));
}
