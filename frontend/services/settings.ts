import { useCallback, useEffect, useRef, useState } from 'react';
import { callable, toaster } from '@steambrew/client';
import { DEFAULT_SETTINGS, parseSettings, type PluginSettings } from '../../shared/settings';
import { SETTING_LABELS, settingWriteFailureNotice } from './setting-value';

/**
 * The only module in the frontend bundle that touches @steambrew/client's IPC.
 *
 * That import is why this file has no test, and the reason is stronger than "it needs a browser":
 * the package's own entry point re-exports its modules extensionlessly, so Node's ESM resolver
 * rejects it with ERR_MODULE_NOT_FOUND before any code runs, and if it did resolve, its webpack
 * module cache initialises at import time by pushing onto window.webpackChunksteamui -- a global only
 * the Steam client defines. Millennium's bundler supplies both; a test runner supplies neither.
 *
 * So nothing here decides anything. Decoding a settings payload is parseSettings in
 * shared/settings.ts, and the words a failure is reported with are in ./setting-value.ts; both import
 * nothing from Steam and are covered by tests. What is left below is two RPC bindings, React state,
 * and the order the three are touched in.
 *
 * Do not alias, destructure, wrap, or pass along `callable`. Both bindings must stay literal
 * `callable(...)` calls on the imported binding, in this file. Millennium's transpiler rewrites that
 * call site to inject the plugin name as a first argument -- verified in the built output as
 * `callable(pluginName,"GetSettings")` -- and it matches on the callee's member path, so any
 * indirection loses the injection and the call resolves against a plugin that does not exist.
 */

/**
 * Why these settings travel over the plugin's own RPC channel and not Millennium's config API.
 *
 * This module used to call `usePluginConfig`, which is Millennium's own reactive hook over the same
 * config file the Lua backend writes. Writes through it landed -- the values reached
 * `config.json` -- but reads never arrived, so the panel displayed DEFAULT_SETTINGS forever while
 * the file held something else. Every click was then computed against a value that was not the
 * stored one: Steam's Toggle calls `onChange(!value)`, so three clicks against a display frozen at
 * the defaults wrote the inverse of the defaults, and the switch never appeared to move.
 *
 * The mechanism is in Millennium's own loader. Its config helper resolves a request and then runs
 * `JSON.parse` on the result, and the IPC layer beneath it answers `undefined` -- resolved, not
 * rejected -- whenever it decides the FFI is unreachable from the calling context. The hook's
 * loader wraps that in an empty `catch {}`, so the parse failure leaves its state at `undefined`
 * with nothing logged anywhere. There is no version of this the plugin can detect or work around
 * from the outside.
 *
 * So the panel reads and writes through `GetSettings` and `SetSetting` on the Lua backend instead.
 * That is the transport the webkit bundle already uses for exactly these three values
 * (webkit/settings.ts), it is a different IPC message type from the config API, and it makes the
 * backend the single owner of settings that docs/ARCHITECTURE.md already describes -- previously
 * the frontend wrote the config file directly while the backend believed it owned it.
 *
 * What is given up is cross-window reactivity: `usePluginConfig` re-rendered every consumer when a
 * value changed anywhere. Nothing here needs that. The panel is the only writer, it is mounted once,
 * and webkit deliberately reads settings once per page load -- which is why every toggle's
 * description tells the user to reopen open pages.
 */
const getSettingsRpc = callable<[], string>('GetSettings');

/**
 * One object parameter, never two positional ones, and this is a constraint of the channel rather
 * than a style choice. Millennium's `callable` forwards `arguments[0]` and nothing else --
 * `callServerMethod(plugin, method, args[0], callSite)` -- so a binding declared
 * `[key: string, value: boolean]` and called with two arguments silently loses the second. The Lua
 * side would then see `value` as nil, refuse the write as non-boolean, and answer with the settings
 * unchanged: every toggle a no-op, with nothing but a line in the backend log to say so.
 *
 * The client package encodes that in the type -- `Params extends [params: Record<string, IPCType>] | []`
 * -- so here the mistake does not compile. The webkit package's `callable` is looser, and the keys
 * matching the backend's parameter names is beyond what either type can state, so
 * tests/backend-rpc.test.ts checks both against backend/main.lua directly. The object's keys arrive as
 * those named parameters, which is why they match `SetSetting(key, value)` exactly.
 *
 * `key: string`, not `key: keyof PluginSettings`: this is a wire signature and what crosses it is
 * JSON. The caller below narrows it, and the backend re-checks it against its own allowlist, because
 * a declaration on this side of an IPC boundary constrains nobody on the other.
 *
 * `string` for the reply because the type demands it -- `Return extends IPCType`, which is
 * `string | number | boolean | void`, so the `unknown` that would state the truth is not available
 * here the way it is in webkit/settings.ts. It is a claim rather than a check, and deliberately not
 * load-bearing: parseSettings takes `unknown` and its first act is to reject a payload that is not a
 * string, so a runtime that hands back something else lands on the defaults instead of on a crash.
 */
const setSettingRpc = callable<[{ key: string; value: boolean }], string>('SetSetting');

/** What the panel needs from this module: the values, a writer, and whether the values are real yet. */
export interface SettingsController {
	settings: PluginSettings;
	setSetting: <K extends keyof PluginSettings>(key: K, value: PluginSettings[K]) => void;
	/**
	 * False until the first read has answered. The panel disables the switches while it is false, and
	 * that is a correctness measure rather than polish: before the read lands, the displayed value is
	 * DEFAULT_SETTINGS, and a click computes `!displayed`. On an account whose stored value differs
	 * from the default, an early click therefore writes the value the user believed they were
	 * changing away from -- which is precisely the bug this rewrite exists to end, reintroduced in a
	 * window a few milliseconds wide.
	 */
	loaded: boolean;
}

/**
 * Read the settings once, then write them one key at a time.
 *
 * One hook for all three settings rather than one per key, which is what the previous
 * `useSetting(key)` shape forced: three hooks meant three independent reads of the same backend on
 * every mount, and three separate pieces of state that could disagree about a value they all took
 * from one config file.
 */
export function useSettings(): SettingsController {
	const [settings, setSettings] = useState<PluginSettings>(() => ({ ...DEFAULT_SETTINGS }));
	const [loaded, setLoaded] = useState(false);

	/**
	 * Guards the state updates in the write path the way the effect's `cancelled` flag guards the
	 * read: a reply that arrives after the panel closes would otherwise set state on an unmounted
	 * component. A ref rather than a piece of state because it is read from a closure that has to see
	 * the current value, not the one captured when the handler was created.
	 */
	const mounted = useRef(true);

	/**
	 * A mirror of the current settings, so the write path can read the value a key held before it was
	 * changed without capturing it. Rolling back to `!value` would be correct only because Steam's
	 * Toggle happens to call `onChange(!displayed)`; this is correct whatever the caller passes,
	 * including the same value twice.
	 *
	 * Assigned during render rather than in an effect: the write path reads it from a click handler,
	 * which cannot run before the render that set it has committed, and an effect would leave it one
	 * render stale on the first paint.
	 */
	const currentSettings = useRef(settings);
	currentSettings.current = settings;

	useEffect(() => {
		mounted.current = true;
		let cancelled = false;

		void (async () => {
			let payload: unknown;
			try {
				payload = await getSettingsRpc();
			} catch (error) {
				// Defaults are already on screen, so there is nothing to apply -- but `loaded` still has
				// to be set, or the switches stay disabled forever and the panel is read-only with no
				// explanation. The console line is what distinguishes that from a working panel.
				console.error('[CS2Tracker] Failed to read settings:', error);
				if (!cancelled) setLoaded(true);
				return;
			}

			if (cancelled) return;
			setSettings(
				parseSettings(payload, (reason) => {
					console.warn(`[CS2Tracker] Unusable settings payload: ${reason}. Falling back to defaults.`);
				}),
			);
			setLoaded(true);
		})();

		return () => {
			cancelled = true;
			mounted.current = false;
		};
	}, []);

	const setSetting = useCallback(<K extends keyof PluginSettings>(key: K, value: PluginSettings[K]): void => {
		/*
		 * Shown immediately, before the write is attempted. The switch is a direct manipulation: it has
		 * to follow the pointer, not an IPC round trip, and the previous design -- display the store's
		 * value and nothing else -- is what made every hiccup in that round trip look like a dead
		 * control.
		 *
		 * A functional update, and per key, so two toggles flipped in quick succession cannot clobber
		 * each other: each one merges into whatever the current state is rather than into the object
		 * its own render closed over.
		 */
		const previous = currentSettings.current[key];
		setSettings((current) => ({ ...current, [key]: value }));

		void (async () => {
			try {
				/*
				 * await, not `.then`, and that is what makes this total. The three failure shapes a write
				 * over an injected IPC binding can take -- a rejected promise, a synchronous throw, and a
				 * return that is not a promise at all -- are all handled by this one try/catch, because
				 * awaiting a non-promise is simply that value. An earlier version of this file needed a
				 * dedicated wrapper to cover the same three; the async form subsumes it.
				 */
				const reply = await setSettingRpc({ key, value });
				if (!mounted.current) return;

				/*
				 * Adopt the backend's own view of the store, so the panel cannot end up showing a value
				 * that was never persisted -- SetSetting answers with the settings as they now are,
				 * including when it refused the write.
				 *
				 * Unless the reply was unusable, in which case the optimistic value stands. Adopting
				 * parseSettings' fallback here would be worse than doing nothing: it returns a complete
				 * DEFAULT_SETTINGS, so one malformed reply would reset the other two switches on screen
				 * to their defaults as a side effect of touching this one.
				 */
				let usable = true;
				const authoritative = parseSettings(reply, (reason) => {
					usable = false;
					console.warn(`[CS2Tracker] Unusable reply saving "${key}": ${reason}. Keeping the value on screen.`);
				});
				if (usable) setSettings(authoritative);
			} catch (error) {
				console.error(`[CS2Tracker] Failed to save "${SETTING_LABELS[key]}":`, error);

				// Roll the optimistic change back, per key and functionally, for the same reason it was
				// applied that way: another setting may have changed while this write was in flight.
				if (mounted.current) setSettings((current) => ({ ...current, [key]: previous }));

				/*
				 * The console line goes first because toaster.toast can throw. It swallows its own
				 * delivery failure, but it reads window.NotificationStore before that try block, so a
				 * Steam that has not built the store yet -- or a Millennium too old to export toaster at
				 * all -- throws from here. The catch keeps a broken diagnostic from becoming the unhandled
				 * rejection this whole block exists to prevent, and the ordering keeps the log line on the
				 * near side of it.
				 *
				 * playSound is off. The toast lands while the user is looking at the switch that just
				 * moved back, so a chime adds alarm rather than information.
				 */
				try {
					toaster.toast({ ...settingWriteFailureNotice(key), playSound: false });
				} catch {
					/* a diagnostic must never change the answer */
				}
			}
		})();
	}, []);

	return { settings, setSetting, loaded };
}
