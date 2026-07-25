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
 * Names a decoded JSON value in a reason string. `typeof` alone is not enough: it answers "object" for both
 * null and an array, which are the two shapes a hand-written guard most often lets through.
 *
 * null and undefined are named bare, without an article, because they are values rather than kinds --
 * "payload was undefined" is the sentence, not "payload was an undefined". Everything else takes an article
 * chosen by the initial letter: `typeof` yields "object" and "undefined" among its answers, and a fixed "a"
 * produced "a object" and "a undefined" in a message whose whole job is to be read by a human at the moment
 * something has gone wrong. Both were reachable -- `parseSettings({})` and `parseSettings(undefined)` are the
 * two commonest things a broken IPC channel hands back.
 */
function jsonKind(value: unknown): string {
	if (value === null) return 'null';
	if (value === undefined) return 'undefined';
	if (Array.isArray(value)) return 'an array';
	const kind = typeof value;
	return `${/^[aeiou]/.test(kind) ? 'an' : 'a'} ${kind}`;
}

/**
 * Report a problem without letting it change the answer.
 *
 * The try/catch is the whole reason this is a function. parseSettings is documented total, and a hook is
 * somebody else's code: without this, passing one that throws would turn a malformed payload from "defaults"
 * into an exception, which is precisely the diagnostics-altering-behaviour that the hook exists to avoid.
 * Nothing is logged about a failed report, because the only place left to log it is the console this design
 * is keeping out of here.
 */
function report(onProblem: ((reason: string) => void) | undefined, reason: string): void {
	try {
		onProblem?.(reason);
	} catch {
		/* a diagnostic must never change the answer */
	}
}

/**
 * Decode a settings payload as it arrives from the Lua backend -- a JSON string over the IPC channel -- into
 * a complete settings object. Total: every malformed input answers with a fresh copy of the defaults, and
 * nothing here throws or writes to the console.
 *
 * It takes `unknown` rather than `string` on purpose, and that is the point of the function rather than
 * defensiveness about it. The IPC helper is typed `callable<Args, T>` with `T` a free type parameter cast
 * straight onto `Promise<T>`, so declaring the return as `string` asserts a shape that nothing checks at
 * runtime. If the Millennium runtime ever hands back an already-decoded object, `JSON.parse` receives
 * "[object Object]" through coercion and throws, a caller's catch substitutes defaults, and the user's real
 * settings are silently ignored on every page from then on. `unknown` makes that unrepresentable: the type of
 * the boundary is "whatever arrived", and the check is the code below rather than a claim in a declaration.
 *
 * `onProblem` is how this stays console-free without going silent. It fires only for a payload that could not
 * be used as given, never for one that legitimately yields defaults, and that distinction is the entire
 * value of it -- a hook that also fired for "{}" would train its reader to ignore it. So an absent or blank
 * payload is quiet: the backend answers "{}" when it cannot encode -- having already logged the reason on the
 * Lua side -- and an empty config is what a first run looks like before anything has been written. Blank
 * rather than strictly empty, because `json.encode` cannot produce whitespace, so a payload of spaces means
 * the same thing an empty one does and not something worth its own vocabulary.
 *
 * The per-key case is the one that matters most in practice, and it is the reason the hook takes a reason
 * string rather than a boolean: a wrong-typed value is a toggle the user set and this code is discarding,
 * which looks from the outside exactly like the feature being broken. It names the keys.
 *
 * Deliberately narrow, and worth knowing why: the backend already logs its own encode failure and answers
 * "{}", so the likely real-world fault is covered on the Lua side. What is left for this to catch is
 * IPC-level corruption and a wrong-typed key that survived encode -- so the hook is a reason string, not a
 * structured report.
 *
 * An unknown key is not reported. It is what a payload from a newer or older build of the plugin looks like,
 * and normalizeSettings ignoring it is the compatibility behaviour rather than a fault.
 */
export function parseSettings(raw: unknown, onProblem?: (reason: string) => void): PluginSettings {
	if (typeof raw !== 'string') {
		report(onProblem, `payload was ${jsonKind(raw)}, not a JSON string`);
		return { ...DEFAULT_SETTINGS };
	}

	if (raw.trim() === '') return { ...DEFAULT_SETTINGS };

	let decoded: unknown;
	try {
		decoded = JSON.parse(raw);
	} catch {
		report(onProblem, 'payload is not valid JSON');
		return { ...DEFAULT_SETTINGS };
	}

	if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded)) {
		report(onProblem, `payload decoded to ${jsonKind(decoded)}, not an object`);
		return { ...DEFAULT_SETTINGS };
	}

	// Read from the decoded object rather than asking normalizeSettings what it changed, so that function keeps
	// the signature every other caller already uses. `key in source` and not a truthiness check: a key that is
	// absent is a default, which is normal, and only a key that is present with the wrong type is a value being
	// thrown away.
	const source = decoded as Record<string, unknown>;
	const discarded = SETTING_KEYS.filter((key) => key in source && typeof source[key] !== 'boolean');
	if (discarded.length > 0) {
		report(onProblem, `discarded non-boolean value for: ${discarded.join(', ')}`);
	}

	return normalizeSettings(decoded);
}
