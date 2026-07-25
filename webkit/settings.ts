import { callable } from '@steambrew/webkit';
import { DEFAULT_SETTINGS, normalizeSettings, type PluginSettings } from '../shared/settings';

/**
 * The only module in the webkit bundle that touches @steambrew/webkit.
 *
 * That import is why this file has no test: the package resolves to a global the Millennium runtime
 * installs, so it does not exist outside the Steam client and a test importing this module cannot load.
 * Keeping the surface to one RPC and one fallback is the mitigation -- normalizeSettings, which is where
 * the actual coercion happens, is tested on its own in tests/settings.test.ts.
 */

/**
 * Bound once at module load, which is the shape Millennium's own examples use and the shape its bundler
 * expects: it rewrites the call site to inject the plugin name, so `callable` cannot be aliased or wrapped
 * without losing that. `[]` because GetSettings takes no arguments, `string` because it answers with JSON
 * rather than an object -- the IPC channel carries strings.
 */
const getSettingsRpc = callable<[], string>('GetSettings');

/**
 * Read the user's settings from the Lua backend, falling back to defaults on any failure.
 *
 * Every failure is the same answer, deliberately. A backend that has not finished loading, an IPC channel
 * that is not up yet, a truncated payload, JSON that will not parse -- none of them are worth their own
 * behaviour, because the useful outcome in all four cases is the plugin running with its documented
 * defaults rather than not running. The log line is what separates "the user turned it off" from "settings
 * never arrived" when somebody reports a missing button.
 *
 * The empty answer is checked before JSON.parse rather than left to the catch: the backend returns "{}"
 * when it cannot encode, and an unreachable backend can answer with nothing at all, and neither of those
 * is a fault to report.
 */
export async function readSettings(): Promise<PluginSettings> {
	try {
		const raw = await getSettingsRpc();
		if (!raw) return { ...DEFAULT_SETTINGS };
		return normalizeSettings(JSON.parse(raw));
	} catch (error) {
		console.error('[CS2Tracker] Failed to read settings:', error);
		return { ...DEFAULT_SETTINGS };
	}
}
