import { usePluginConfig } from '@steambrew/client';
import { type PluginSettings } from '../../shared/settings';
import { guardSettingWrite, resolveSetting } from './setting-value';

/**
 * The only module in the frontend bundle that touches @steambrew/client's config API.
 *
 * That import is why this file has no test, and the reason is stronger than "it needs a browser":
 * the package's own entry point re-exports its modules extensionlessly, so Node's ESM resolver
 * rejects it with ERR_MODULE_NOT_FOUND before any code runs, and if it did resolve, its webpack
 * module cache initialises at import time by pushing onto window.webpackChunksteamui -- a global only
 * the Steam client defines. Millennium's bundler supplies both; a test runner supplies neither.
 *
 * So nothing here decides anything. The two functions this hook is made of live in
 * ./setting-value.ts, which imports nothing from Steam and is covered by
 * tests/frontend-setting-value.test.ts. What is left below is the hook call, the wiring, and one
 * console line.
 *
 * Do not alias, destructure, wrap, or pass along usePluginConfig. It must stay a literal
 * `usePluginConfig(...)` call on the imported binding, in this file. Millennium's transpiler rewrites
 * that call site to inject the plugin name as a first argument -- verified in the built output as
 * `usePluginConfig(pluginName, key)` -- and it matches on the callee's member path, so any indirection
 * loses the injection. Nothing errors when that happens: the key shifts into the plugin-name position,
 * so every read and write silently targets a plugin named after the setting, and the user's toggles
 * simply never persist.
 */

/**
 * Read and write one setting through Millennium's config API.
 *
 * usePluginConfig is reactive, and that is what makes this a two-line hook rather than a store: a
 * change made here, by the Lua backend, or by another mounted consumer re-renders every consumer of
 * that key, so two toggles bound to the same setting cannot drift and nothing has to be invalidated
 * by hand.
 *
 * Keyed per setting rather than reading the whole config, because the no-argument overload of
 * usePluginConfig returns `Record<string, any>` and a setter taking `(key, value)`, which would put
 * an untyped key at every call site. The typed overload makes K a key of PluginSettings, so a
 * mistyped name is a compile error and the value type follows from it.
 *
 * The returned setter is recreated on each render, which is deliberate: Steam's toggles take it as a
 * plain onChange, none of them are memoised, and useCallback here would add a dependency array to
 * keep correct for no measurable benefit.
 */
export function useSetting<K extends keyof PluginSettings>(
	key: K,
): [PluginSettings[K], (value: PluginSettings[K]) => void] {
	const [stored, setStored] = usePluginConfig<PluginSettings[K]>(key);

	const update = guardSettingWrite(setStored, (error: unknown) => {
		console.error(`[CS2Tracker] Failed to save "${key}":`, error);
	});

	return [resolveSetting(key, stored), update];
}
