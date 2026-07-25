import { describe, expect, it, vi } from 'vitest';
import { guardSettingWrite, resolveSetting } from '../frontend/services/setting-value';
import { DEFAULT_SETTINGS, type PluginSettings } from '../shared/settings';

/** Every setting key, taken from the defaults so a fourth key cannot be added without reaching these cases. */
const KEYS = Object.keys(DEFAULT_SETTINGS) as Array<keyof PluginSettings>;

/**
 * Drain the microtask queue. A timer rather than an awaited Promise.resolve: the rejection paths below
 * settle a chain whose length is an implementation detail, and one awaited tick is not guaranteed to be
 * enough.
 */
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe('resolveSetting', () => {
	it('returns a stored boolean as given', () => {
		for (const key of KEYS) {
			expect(resolveSetting(key, true)).toBe(true);
			expect(resolveSetting(key, false)).toBe(false);
		}
	});

	/**
	 * The case a truthiness check would get wrong, and it is not hypothetical: two of the three settings
	 * default to true, so treating a falsy stored value as "nothing stored" would make those two
	 * impossible to switch off -- the toggle would snap back on the next render.
	 */
	it('returns a stored false even when the default is true', () => {
		const defaultsToTrue = KEYS.filter((key) => DEFAULT_SETTINGS[key] === true);
		expect(defaultsToTrue.length).toBeGreaterThan(0);

		for (const key of defaultsToTrue) {
			expect(resolveSetting(key, false)).toBe(false);
		}
	});

	// The first render, before the config store has answered. Routine, and the common case at mount.
	it('falls back to the default when nothing is stored yet', () => {
		for (const key of KEYS) {
			expect(resolveSetting(key, undefined)).toBe(DEFAULT_SETTINGS[key]);
		}
	});

	/**
	 * Each key answers with its own default and not with some shared notion of "off". Stated separately
	 * from the case above because the implementation reads a whole normalised object and indexes it, so
	 * an off-by-one key would still return a plausible boolean.
	 */
	it('falls back per key, not to a single value', () => {
		expect(resolveSetting('openExternal', undefined)).toBe(false);
		expect(resolveSetting('showOnProfiles', undefined)).toBe(true);
		expect(resolveSetting('showOnFriendLists', undefined)).toBe(true);
	});

	/**
	 * The config store is a JSON file the user can edit and the backend also writes, and the hook asks
	 * it for a boolean through a free type parameter that nothing checks. 'false' and 0 are the ones
	 * worth naming: a coercing implementation would read the string as true and the number as false,
	 * both of which are answers rather than errors.
	 */
	it('falls back for a stored value of the wrong type', () => {
		for (const stored of [null, 'true', 'false', '', 0, 1, NaN, {}, [], () => true]) {
			for (const key of KEYS) {
				expect(resolveSetting(key, stored)).toBe(DEFAULT_SETTINGS[key]);
			}
		}
	});

	// DEFAULT_SETTINGS is frozen, so a mutating implementation would throw in strict mode rather than
	// corrupt the shipped defaults. Asserted anyway: this reads them on every render of every toggle.
	it('leaves the shipped defaults alone', () => {
		const before = { ...DEFAULT_SETTINGS };
		resolveSetting('openExternal', true);
		resolveSetting('showOnProfiles', false);
		expect({ ...DEFAULT_SETTINGS }).toEqual(before);
	});
});

describe('guardSettingWrite', () => {
	it('passes the value through to the write', () => {
		const write = vi.fn(async () => {});
		const onFailure = vi.fn();

		guardSettingWrite(write, onFailure)(true);

		expect(write).toHaveBeenCalledTimes(1);
		expect(write).toHaveBeenCalledWith(true);
		expect(onFailure).not.toHaveBeenCalled();
	});

	// A React onChange handler has nothing to await, so the wrapper has to be synchronous and return
	// nothing. If it returned the promise instead, every caller would have to remember to void it.
	it('returns nothing and does not wait for the write', async () => {
		let settle: (() => void) | undefined;
		const write = vi.fn(() => new Promise<void>((resolve) => (settle = resolve)));

		expect(guardSettingWrite(write, vi.fn())(false)).toBeUndefined();

		settle?.();
		await flush();
	});

	it('does not report anything when the write succeeds', async () => {
		const onFailure = vi.fn();
		guardSettingWrite(async () => {}, onFailure)(true);
		await flush();
		expect(onFailure).not.toHaveBeenCalled();
	});

	/**
	 * The documented failure. Reported exactly once and with the original error, because the console line
	 * next door is the only thing that distinguishes "the write failed" from "the user left it off" when
	 * somebody reports a toggle that will not stick.
	 */
	it('reports a rejected write without throwing', async () => {
		const boom = new Error('config write failed');
		const onFailure = vi.fn();

		expect(() => guardSettingWrite(async () => Promise.reject(boom), onFailure)(true)).not.toThrow();
		await flush();

		expect(onFailure).toHaveBeenCalledTimes(1);
		expect(onFailure).toHaveBeenCalledWith(boom);
	});

	// `write(value).catch(...)` alone would let this straight through into the event handler.
	it('reports a write that throws synchronously', async () => {
		const boom = new Error('not connected');
		const onFailure = vi.fn();

		expect(() =>
			guardSettingWrite(() => {
				throw boom;
			}, onFailure)(true),
		).not.toThrow();
		await flush();

		expect(onFailure).toHaveBeenCalledTimes(1);
		expect(onFailure).toHaveBeenCalledWith(boom);
	});

	/**
	 * The setter's declared return type is Promise<void>, but the implementation behind it is injected by
	 * the Millennium runtime rather than the package this repo compiles against. Reading `.catch` off a
	 * bare undefined would throw a TypeError out of the handler -- the one failure mode where the write
	 * actually succeeded.
	 */
	it('survives a write that does not return a promise', async () => {
		const onFailure = vi.fn();
		const write = (() => undefined) as unknown as (value: boolean) => Promise<void>;

		expect(() => guardSettingWrite(write, onFailure)(true)).not.toThrow();
		await flush();

		expect(onFailure).not.toHaveBeenCalled();
	});

	/**
	 * A throwing reporter must not reintroduce what the wrapper exists to prevent. Both entry points are
	 * covered because they swallow differently: the synchronous throw is caught by the same try that
	 * called the write, while the rejection path runs the reporter inside a promise handler, where a
	 * throw would become the unhandled rejection this function is here to avoid.
	 *
	 * Unhandled rejections are asserted on rather than merely awaited: vitest surfaces them as noise
	 * against a later test, or not at all, so the listener is the only thing that makes this fail here.
	 */
	it('swallows a throw from the reporter itself', async () => {
		const unhandled: unknown[] = [];
		const record = (event: PromiseRejectionEvent | { reason?: unknown }): void => {
			unhandled.push('reason' in event ? event.reason : event);
		};
		globalThis.addEventListener('unhandledrejection', record as EventListener);

		const onFailure = vi.fn(() => {
			throw new Error('the logger is broken too');
		});

		try {
			expect(() => guardSettingWrite(async () => Promise.reject(new Error('rejected')), onFailure)(true)).not.toThrow();
			expect(() =>
				guardSettingWrite(() => {
					throw new Error('threw');
				}, onFailure)(true),
			).not.toThrow();
			await flush();
		} finally {
			globalThis.removeEventListener('unhandledrejection', record as EventListener);
		}

		expect(onFailure).toHaveBeenCalledTimes(2);
		expect(unhandled).toEqual([]);
	});

	// One wrapper, many events: a toggle is clicked repeatedly, and the previous failure must not stick
	// to the next write or suppress its report.
	it('handles each call independently', async () => {
		const results = [Promise.reject(new Error('first')), Promise.resolve(), Promise.reject(new Error('third'))];
		const onFailure = vi.fn();
		const update = guardSettingWrite(() => results.shift()!, onFailure);

		update(true);
		update(false);
		update(true);
		await flush();

		expect(onFailure).toHaveBeenCalledTimes(2);
		expect((onFailure.mock.calls[0][0] as Error).message).toBe('first');
		expect((onFailure.mock.calls[1][0] as Error).message).toBe('third');
	});
});
