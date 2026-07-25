export interface PluginSettings {
	openExternal: boolean;
	showOnProfiles: boolean;
	showOnFriendLists: boolean;
}

export const DEFAULT_SETTINGS: Readonly<PluginSettings> = Object.freeze({
	openExternal: false,
	showOnProfiles: true,
	showOnFriendLists: true,
});

const SETTING_KEYS = Object.keys(DEFAULT_SETTINGS) as Array<keyof PluginSettings>;

/** Coerce anything the backend hands us into a complete, well-typed settings object. */
export function normalizeSettings(raw: unknown): PluginSettings {
	const result = { ...DEFAULT_SETTINGS };
	if (!raw || typeof raw !== 'object') return result;

	const source = raw as Record<string, unknown>;
	for (const key of SETTING_KEYS) {
		if (typeof source[key] === 'boolean') result[key] = source[key] as boolean;
	}
	return result;
}

/**
 * Decode a settings payload as it arrives from the Lua backend -- a JSON string over the IPC channel -- into
 * a complete settings object. Total: every malformed input answers with a fresh copy of the defaults, and
 * nothing here throws or logs.
 *
 * It takes `unknown` rather than `string` on purpose, and that is the whole point of the function rather
 * than defensiveness about it. The IPC helper is typed `callable<Args, T>` with `T` a free type parameter
 * cast straight onto `Promise<T>`, so declaring the return as `string` asserts a shape that nothing checks
 * at runtime. If the Millennium runtime ever hands back an already-decoded object, `JSON.parse` receives
 * "[object Object]" through coercion and throws, a caller's catch substitutes defaults, and the user's real
 * settings are silently ignored on every page from then on. `unknown` makes that unrepresentable: the type
 * of the boundary is "whatever arrived", and the check is the code below rather than a claim in a
 * declaration.
 *
 * The whitespace check earns its place next to the falsy one because the backend answers "{}" when it
 * cannot encode and an unreachable one can answer with nothing at all -- neither is a fault, and neither
 * should reach JSON.parse to be reported as one.
 *
 * Nothing is logged here, deliberately. The interesting failure to a user is "settings never arrived",
 * which is a property of the call and not of the payload, so the log line belongs at the RPC boundary where
 * the error object still exists. A helper that writes to console is also a helper that cannot be tested
 * without a spy on every case.
 */
export function parseSettings(raw: unknown): PluginSettings {
	if (typeof raw !== 'string' || raw.trim() === '') return { ...DEFAULT_SETTINGS };
	try {
		return normalizeSettings(JSON.parse(raw));
	} catch {
		return { ...DEFAULT_SETTINGS };
	}
}
