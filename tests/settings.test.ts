import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, normalizeSettings, parseSettings } from '../shared/settings';

describe('DEFAULT_SETTINGS', () => {
	// Pinned against literals, not against the imported object: the Lua backend hardcodes these
	// same three values, so a change here has to break a test rather than drift silently.
	it('ships the documented default for every key', () => {
		expect(DEFAULT_SETTINGS).toEqual({
			openExternal: false,
			showOnProfiles: true,
			showOnFriendLists: true,
		});
	});

	it('is frozen so a consumer cannot mutate the shared defaults', () => {
		expect(Object.isFrozen(DEFAULT_SETTINGS)).toBe(true);
	});
});

describe('normalizeSettings', () => {
	it('returns the defaults for null, undefined, and non-objects', () => {
		expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS);
		expect(normalizeSettings(undefined)).toEqual(DEFAULT_SETTINGS);
		expect(normalizeSettings('nope')).toEqual(DEFAULT_SETTINGS);
		expect(normalizeSettings(42)).toEqual(DEFAULT_SETTINGS);
	});

	it('keeps valid boolean values', () => {
		expect(normalizeSettings({ openExternal: true, showOnProfiles: false, showOnFriendLists: false })).toEqual({
			openExternal: true,
			showOnProfiles: false,
			showOnFriendLists: false,
		});
	});

	it('falls back per key when a value has the wrong type', () => {
		expect(normalizeSettings({ openExternal: 'yes', showOnProfiles: false })).toEqual({
			openExternal: false,
			showOnProfiles: false,
			showOnFriendLists: true,
		});
	});

	it('ignores unknown keys', () => {
		expect(normalizeSettings({ nope: 1 })).toEqual(DEFAULT_SETTINGS);
	});

	it('returns a fresh object each time', () => {
		const first = normalizeSettings(null);
		first.openExternal = true;
		expect(normalizeSettings(null).openExternal).toBe(false);
	});
});

/**
 * The whole backend boundary, in one total function. It lives here rather than beside the RPC call because
 * the module that makes that call imports @steambrew/webkit, which resolves to a runtime global that exists
 * only inside the Steam client -- so a test cannot load it, and anything left on that side of the line is
 * verified by hand or not at all. This module imports nothing, so all of it is reachable.
 */
describe('parseSettings', () => {
	/**
	 * The case that pays for the function existing.
	 *
	 * JSON.parse('{"openExternal":"false"}') yields the *string* "false", which is truthy, so a decode that
	 * skipped coercion would send every link through the external-browser scheme -- the exact opposite of
	 * what the user asked for, from a payload that parsed without error. Asserted against the literal rather
	 * than against DEFAULT_SETTINGS so that a change to the defaults cannot make this pass for the wrong
	 * reason.
	 */
	it('coerces a value that parsed cleanly but has the wrong type', () => {
		expect(parseSettings('{"openExternal":"false"}')).toEqual({
			openExternal: false,
			showOnProfiles: true,
			showOnFriendLists: true,
		});
	});

	it('decodes a well-formed payload', () => {
		expect(parseSettings('{"openExternal":true,"showOnProfiles":false,"showOnFriendLists":true}')).toEqual({
			openExternal: true,
			showOnProfiles: false,
			showOnFriendLists: true,
		});
	});

	/**
	 * `unknown` rather than `string` is the contract, because the IPC helper's return type is an assertion
	 * and not a check: `callable<Args, T>` casts a free type parameter straight onto Promise<T>, so nothing
	 * validates it at runtime. The object case is the one that matters -- if Millennium ever hands back an
	 * already-decoded payload, a string-typed decoder coerces it to "[object Object]" and throws, and the
	 * user's real settings are ignored on every page from then on with only a console line to show it.
	 */
	it('returns the defaults for anything that is not a string', () => {
		expect(parseSettings(undefined)).toEqual(DEFAULT_SETTINGS);
		expect(parseSettings(null)).toEqual(DEFAULT_SETTINGS);
		expect(parseSettings({ openExternal: true })).toEqual(DEFAULT_SETTINGS);
		expect(parseSettings(42)).toEqual(DEFAULT_SETTINGS);
		expect(parseSettings(true)).toEqual(DEFAULT_SETTINGS);
	});

	// "" is what an unreachable backend answers with and "{}" is what a backend that could not encode
	// answers with; whitespace is neither, and all three have to stop short of JSON.parse.
	it('returns the defaults for an empty or blank payload', () => {
		expect(parseSettings('')).toEqual(DEFAULT_SETTINGS);
		expect(parseSettings('   ')).toEqual(DEFAULT_SETTINGS);
		expect(parseSettings('\n\t')).toEqual(DEFAULT_SETTINGS);
		expect(parseSettings('{}')).toEqual(DEFAULT_SETTINGS);
	});

	it('returns the defaults for JSON that will not parse', () => {
		expect(parseSettings('{')).toEqual(DEFAULT_SETTINGS);
		expect(parseSettings('not json')).toEqual(DEFAULT_SETTINGS);
		expect(parseSettings('{"openExternal":}')).toEqual(DEFAULT_SETTINGS);
	});

	// Each of these parses cleanly and is not a settings object. null and the array are the ones a hand-typed
	// guard tends to miss, since typeof null and typeof [] are both 'object'.
	it('returns the defaults for JSON that parses to something other than an object', () => {
		expect(parseSettings('null')).toEqual(DEFAULT_SETTINGS);
		expect(parseSettings('[]')).toEqual(DEFAULT_SETTINGS);
		expect(parseSettings('[{"openExternal":true}]')).toEqual(DEFAULT_SETTINGS);
		expect(parseSettings('7')).toEqual(DEFAULT_SETTINGS);
		expect(parseSettings('"openExternal"')).toEqual(DEFAULT_SETTINGS);
	});

	it('never throws, whatever it is handed', () => {
		const hostile: unknown[] = [undefined, null, 0, Symbol('nope'), () => {}, '{', '[', '\0'];
		for (const value of hostile) {
			expect(() => parseSettings(value)).not.toThrow();
		}
	});

	/**
	 * The defaults are frozen, so handing the caller a reference rather than a copy would make a settings
	 * object that silently refuses assignment -- and outside strict mode the assignment is dropped without a
	 * word, so a caller's override would look applied and not be.
	 *
	 * Every exit is listed by hand, and that is the point rather than thoroughness for its own sake. There are
	 * five, `toEqual(DEFAULT_SETTINGS)` passes for the frozen object itself, and identity is invisible to every
	 * other assertion in this file -- so replacing `{ ...DEFAULT_SETTINGS }` with `DEFAULT_SETTINGS` at any one
	 * of them used to survive the whole suite. One input per exit: 42 is the non-string branch, '' the blank
	 * branch, 'nope' the JSON-failure branch, 'null' the decoded-to-something-else branch, and '{}' the normal
	 * path through normalizeSettings.
	 */
	it('returns a fresh object from every exit, never the frozen defaults', () => {
		expect(parseSettings(42)).not.toBe(DEFAULT_SETTINGS);
		expect(parseSettings('')).not.toBe(DEFAULT_SETTINGS);
		expect(parseSettings('nope')).not.toBe(DEFAULT_SETTINGS);
		expect(parseSettings('null')).not.toBe(DEFAULT_SETTINGS);
		expect(parseSettings('{}')).not.toBe(DEFAULT_SETTINGS);
	});

	// Identity is not quite the whole claim: the object also has to be writable, which is what a caller
	// spreading or adjusting the result depends on.
	it('returns an object the caller can write to', () => {
		const first = parseSettings('nope');
		first.openExternal = true;
		expect(parseSettings('nope').openExternal).toBe(false);
	});
});

/**
 * The diagnostic hook. It exists because keeping console out of parseSettings made an unusable payload silent,
 * and silence is the one thing the webkit bundle cannot afford here: a discarded toggle looks from the outside
 * exactly like the feature being broken.
 *
 * What it must not do is cry wolf. A hook that also fired for a legitimately empty config would fire on every
 * first run, and a reader who learns to ignore it has lost nothing by ignoring it -- which is why the quiet
 * cases below are as load-bearing as the loud ones.
 */
describe('parseSettings problem reporting', () => {
	it('reports a payload that is not a string, naming what arrived', () => {
		const onProblem = vi.fn();

		expect(parseSettings({ openExternal: true }, onProblem)).toEqual(DEFAULT_SETTINGS);

		expect(onProblem).toHaveBeenCalledOnce();
		expect(onProblem.mock.calls[0][0]).toContain('object');
	});

	// null and an array are the two that typeof alone cannot tell from a settings object, so the reason string
	// has to distinguish them by hand -- and a reason that said "an object" for either would be worse than none.
	it('names null and an array rather than calling them objects', () => {
		const onNull = vi.fn();
		parseSettings(null, onNull);
		expect(onNull.mock.calls[0][0]).toContain('null');

		const onArray = vi.fn();
		parseSettings('[]', onArray);
		expect(onArray.mock.calls[0][0]).toContain('array');
	});

	/**
	 * The reason string is prose a human reads at the moment something is already wrong, so it has to parse as
	 * English. A single hardcoded article gave "a undefined" and "a object" -- and both are reachable, since an
	 * absent payload and an already-decoded one are the two commonest things a broken IPC channel returns.
	 */
	it('names what arrived in readable English, whatever arrived', () => {
		const reasonFor = (raw: unknown): string => {
			const onProblem = vi.fn();
			parseSettings(raw, onProblem);
			return String(onProblem.mock.calls[0][0]);
		};

		expect(reasonFor(undefined)).toContain('undefined');
		expect(reasonFor(undefined)).not.toContain('a undefined');
		expect(reasonFor({ openExternal: true })).toContain('an object');
		expect(reasonFor(42)).toContain('a number');
		expect(reasonFor(true)).toContain('a boolean');
		expect(reasonFor('7')).toContain('a number');
		expect(reasonFor('"openExternal"')).toContain('a string');
	});

	it('reports a non-blank payload that is not valid JSON', () => {
		const onProblem = vi.fn();

		expect(parseSettings('{"openExternal":', onProblem)).toEqual(DEFAULT_SETTINGS);

		expect(onProblem).toHaveBeenCalledOnce();
		expect(onProblem.mock.calls[0][0]).toContain('JSON');
	});

	it('reports JSON that parses to something other than an object', () => {
		for (const payload of ['null', '[]', '7', '"openExternal"', 'true']) {
			const onProblem = vi.fn();
			expect(parseSettings(payload, onProblem)).toEqual(DEFAULT_SETTINGS);
			expect(onProblem).toHaveBeenCalledOnce();
		}
	});

	/**
	 * The case worth the whole mechanism. A wrong-typed value parsed cleanly, so nothing failed -- the user set
	 * a toggle and this code threw it away. Naming the key is the point: "settings were unusable" sends a
	 * reader to the IPC channel, and "discarded openExternal" sends them to the one line that is wrong.
	 */
	it('reports a discarded per-key value and names the key', () => {
		const onProblem = vi.fn();

		expect(parseSettings('{"openExternal":"false"}', onProblem).openExternal).toBe(false);

		expect(onProblem).toHaveBeenCalledOnce();
		expect(onProblem.mock.calls[0][0]).toContain('openExternal');
	});

	it('names every discarded key, not just the first', () => {
		const onProblem = vi.fn();

		parseSettings('{"openExternal":"false","showOnProfiles":0,"showOnFriendLists":true}', onProblem);

		expect(onProblem).toHaveBeenCalledOnce();
		expect(onProblem.mock.calls[0][0]).toContain('openExternal');
		expect(onProblem.mock.calls[0][0]).toContain('showOnProfiles');
		expect(onProblem.mock.calls[0][0]).not.toContain('showOnFriendLists');
	});

	/**
	 * "{}" is valid JSON, an object, and exactly what a first run looks like before anything has been written --
	 * and it is also what the backend answers with when its own json.encode fails, having already logged the
	 * reason on the Lua side. Firing here would put a warning in the console of every fresh install.
	 */
	it('stays quiet for an empty config', () => {
		const onProblem = vi.fn();

		expect(parseSettings('{}', onProblem)).toEqual(DEFAULT_SETTINGS);

		expect(onProblem).not.toHaveBeenCalled();
	});

	it('stays quiet for a well-formed payload', () => {
		const onProblem = vi.fn();

		parseSettings('{"openExternal":true,"showOnProfiles":false,"showOnFriendLists":true}', onProblem);

		expect(onProblem).not.toHaveBeenCalled();
	});

	// Blank rather than strictly empty: json.encode cannot produce whitespace, so a payload of spaces means
	// the same thing an empty one does, and giving it its own reason would be inventing a distinction.
	it('stays quiet for an empty or blank payload', () => {
		const onProblem = vi.fn();

		parseSettings('', onProblem);
		parseSettings('   ', onProblem);
		parseSettings('\n\t', onProblem);

		expect(onProblem).not.toHaveBeenCalled();
	});

	// A key nobody here knows about is what a payload from a newer or older build looks like. Ignoring it is the
	// compatibility behaviour, not a fault, so reporting it would make every future settings addition noisy.
	it('stays quiet for a key it does not know', () => {
		const onProblem = vi.fn();

		expect(parseSettings('{"somethingNew":1}', onProblem)).toEqual(DEFAULT_SETTINGS);

		expect(onProblem).not.toHaveBeenCalled();
	});

	// An absent key is a default, which is the normal shape of a partial config, not a discarded value.
	it('stays quiet for a payload that only sets some of the keys', () => {
		const onProblem = vi.fn();

		expect(parseSettings('{"openExternal":true}', onProblem)).toEqual({
			openExternal: true,
			showOnProfiles: true,
			showOnFriendLists: true,
		});

		expect(onProblem).not.toHaveBeenCalled();
	});

	/**
	 * The hook is diagnostics, so it cannot be allowed to decide anything -- including by failing. Without the
	 * swallow inside parseSettings, a hook that threw would turn a malformed payload from "defaults" into an
	 * exception at the call site, which is the exact class of bug the hook was added to help find.
	 */
	it('is unaffected by a hook that throws or returns something', () => {
		const thrower = () => {
			throw new Error('boom');
		};

		expect(() => parseSettings('{', thrower)).not.toThrow();
		expect(parseSettings('{', thrower)).toEqual(DEFAULT_SETTINGS);
		expect(parseSettings('{"openExternal":"false"}', thrower).openExternal).toBe(false);
		expect(parseSettings('{"openExternal":true}', () => 'ignored' as unknown as void).openExternal).toBe(true);
	});

	it('is optional', () => {
		expect(() => parseSettings('{')).not.toThrow();
		expect(parseSettings('{"openExternal":"false"}').openExternal).toBe(false);
	});
});
