import { normalizeSettings, type PluginSettings } from '../../shared/settings';

/**
 * Every decision useSetting makes, and every word it needs, in a module that imports nothing from Steam.
 *
 * Its own file for the reason webkit/teardown.ts is its own file: the only thing that would make any
 * of this unreachable by a test is sharing a module with the one import that requires the Steam
 * client. @steambrew/client cannot be loaded outside it -- see frontend/services/settings.ts for
 * why -- so anything left in that file is untestable by construction, and both functions below are
 * exactly the parts that did not have to be. What remains next door is the hook call and a console
 * line, neither of which decides anything.
 */

/**
 * Choose between a value Millennium's config store handed back and the shipped default for that key.
 *
 * The `unknown` parameter is the honest type and the reason this function exists. usePluginConfig is
 * declared `<T>(key: string): [T | undefined, ...]` with `T` a free type parameter, so asking it for
 * a boolean is a claim nothing checks at runtime -- the value comes from a JSON config file the user
 * can edit and the backend also writes. Taking `unknown` moves the check from a declaration into
 * code that can be tested.
 *
 * Two distinct callers of the fallback, and it matters that they behave identically: `undefined` on
 * the first render, before the stored value has arrived, and a stored value of the wrong type. The
 * first is routine and happens once per mount; the second means a hand-edited or stale config.
 *
 * Delegates the actual rule to normalizeSettings rather than repeating `typeof stored === 'boolean'`,
 * so there is one definition of what counts as a usable value for a settings key and it is already
 * covered by tests/settings.test.ts. A local copy would read as harmless and drift the moment
 * PluginSettings gains a key that is not a boolean: the copy would then discard every legitimate
 * value for it and quietly serve the default forever.
 */
export function resolveSetting<K extends keyof PluginSettings>(key: K, stored: unknown): PluginSettings[K] {
	return normalizeSettings({ [key]: stored })[key];
}

/**
 * The name each setting goes by on screen, in one place because two surfaces show it: the toggle the
 * user clicks and the toast that appears when saving it fails. Written here rather than inline in the
 * panel so that the toast cannot name a setting differently from the toggle it belongs to, and so that
 * the words are covered by a test -- the panel is not.
 *
 * Labels only. Each toggle's longer description stays in the panel, where it is prose next to the
 * control it describes and nothing else needs to agree with it.
 *
 * Typed as a total Record, so a fourth setting key is a compile error here rather than an undefined
 * label in a toast.
 */
export const SETTING_LABELS: Readonly<Record<keyof PluginSettings, string>> = Object.freeze({
	openExternal: 'Open in external browser',
	showOnProfiles: 'Show on profile pages',
	showOnFriendLists: 'Show on friend lists',
});

/**
 * What to tell the user when a setting could not be saved.
 *
 * The panel shows the value the config store holds, with no optimistic local state, so a failed write
 * shows up as the toggle sliding back to where it was -- indistinguishable from a click that never
 * registered. Before this, the only trace was a console line the user will never open. Two sentences in
 * Steam's own notification surface are the smallest thing that closes that gap, and naming the setting
 * matters because by the time the write fails the user may have flipped another one.
 *
 * Returns the words and not a toast, so this module stays free of Steam: frontend/services/settings.ts
 * spreads it into toaster.toast(). The shape is deliberately a subset of Steam's ToastData -- title and
 * body are the only two of its fields that are required -- so structural typing does the rest without a
 * type import from a package a test cannot load.
 */
export function settingWriteFailureNotice(key: keyof PluginSettings): { title: string; body: string } {
	return {
		title: 'CS2Tracker Extension',
		body: `Could not save "${SETTING_LABELS[key]}". The setting was left unchanged.`,
	};
}

/**
 * Wrap an async write as a fire-and-forget one that cannot fail into its caller.
 *
 * The caller is a React event handler, so a failure has nowhere to go: throwing from a handler --
 * synchronously or as an unhandled rejection -- unmounts the panel through Steam's error boundary
 * and takes the rest of the settings UI with it, over a write that the user can simply retry. The
 * contract is therefore total. It reports and returns, and the displayed value stays whatever the
 * config store still holds, which is the previous one.
 *
 * Three failure shapes, and the reason all three are handled is that `write` is Millennium's
 * injected implementation rather than the stub this repo compiles against, so its declared type is
 * evidence of intent and not of behaviour:
 *   - a rejected promise, which is the documented one and the only one the declared type admits;
 *   - a synchronous throw, which `write(value).catch(...)` alone would let straight through;
 *   - a return that is not a promise, on which reading `.catch` would itself throw a TypeError.
 * Promise.resolve covers the third and is a no-op on a real promise -- it hands back the same object
 * rather than wrapping it -- so the ordinary path is unchanged.
 *
 * onFailure is a parameter instead of a console call so that this module stays free of both Steam and
 * the console, matching parseSettings in shared/settings.ts. Its throw is swallowed for the same
 * reason as there: a diagnostic that can change the outcome is worse than no diagnostic, and here it
 * would specifically resurrect the unhandled rejection this function exists to prevent.
 */
export function guardSettingWrite<T>(
	write: (value: T) => Promise<void>,
	onFailure: (error: unknown) => void,
): (value: T) => void {
	const fail = (error: unknown): void => {
		try {
			onFailure(error);
		} catch {
			/* a diagnostic must never change the answer */
		}
	};

	return (value: T): void => {
		try {
			void Promise.resolve(write(value)).catch(fail);
		} catch (error) {
			fail(error);
		}
	};
}
