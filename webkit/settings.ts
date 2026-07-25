import { callable } from '@steambrew/webkit';
import { DEFAULT_SETTINGS, parseSettings, type PluginSettings } from '../shared/settings';

/**
 * The only module in the webkit bundle that touches @steambrew/webkit.
 *
 * That import is why this file has no test: the package resolves to a global the Millennium runtime
 * installs, so it does not exist outside the Steam client and a test importing this module cannot load. The
 * mitigation is that nothing decides anything here. Both lines of the body are the IPC call and its failure
 * answer; the decode, with every malformed-payload case it has to survive, is parseSettings in
 * shared/settings.ts, which imports nothing and is tested exhaustively.
 */

/**
 * Bound once at module load, which is what Millennium's bundler expects rather than merely what its examples
 * do: it rewrites the call site to inject the plugin name -- verified in the built output as
 * `callable(pluginName,"GetSettings")` -- so the binding cannot be aliased or deferred without losing that.
 *
 * `unknown`, not `string`, and the difference is the point. `T` here is a free type parameter cast straight
 * onto `Promise<T>` with nothing validating it, so `callable<[], string>` would be an assertion dressed as a
 * type: it reads as though the payload had been checked. `unknown` states the truth -- the channel carries
 * whatever the runtime put on it -- and makes checking it parseSettings' job, which is where it can be
 * tested.
 */
const getSettingsRpc = callable<[], unknown>('GetSettings');

/**
 * Read the user's settings from the Lua backend, falling back to defaults on any failure.
 *
 * The try/catch covers exactly one thing parseSettings cannot: a rejected promise, which is what an
 * unreachable backend or an IPC channel that is not up yet produces. Every other failure -- an empty answer,
 * a truncated payload, JSON that will not parse, a value of the wrong type, a payload that is not a string at
 * all -- is total inside parseSettings and never reaches here.
 *
 * The log line is what separates "the user turned it off" from "settings never arrived" when somebody reports
 * a missing button, and it sits here because this is the only place the error object exists.
 */
export async function readSettings(): Promise<PluginSettings> {
	try {
		return parseSettings(await getSettingsRpc());
	} catch (error) {
		console.error('[CS2Tracker] Failed to read settings:', error);
		return { ...DEFAULT_SETTINGS };
	}
}
