import { afterEach, describe, expect, it, vi } from 'vitest';
import { disposeAll, registerDisposer } from '../webkit/lifecycle';

/**
 * The registry is module state shared by every test in this file, so each test has to hand it back
 * empty. Mocks are restored here too: the throwing case below silences console.error, and leaving that
 * spy installed would hide output from any test that ran after it.
 */
afterEach(() => {
	disposeAll();
	vi.restoreAllMocks();
});

describe('lifecycle', () => {
	it('runs every registered disposer', () => {
		const first = vi.fn();
		const second = vi.fn();
		registerDisposer(first);
		registerDisposer(second);
		disposeAll();
		expect(first).toHaveBeenCalledOnce();
		expect(second).toHaveBeenCalledOnce();
	});

	it('runs disposers in reverse registration order', () => {
		const order: number[] = [];
		registerDisposer(() => order.push(1));
		registerDisposer(() => order.push(2));
		disposeAll();
		expect(order).toEqual([2, 1]);
	});

	it('does not run a disposer twice', () => {
		const fn = vi.fn();
		registerDisposer(fn);
		disposeAll();
		disposeAll();
		expect(fn).toHaveBeenCalledOnce();
	});

	/**
	 * A disposer that throws must not take the rest of the teardown with it -- an observer left
	 * connected because a sibling timer failed to clear keeps mutating the page forever. The spy keeps
	 * the suite's output clean and doubles as the assertion that the failure is reported rather than
	 * swallowed.
	 */
	it('keeps going when a disposer throws', () => {
		const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
		const fn = vi.fn();
		registerDisposer(fn);
		registerDisposer(() => {
			throw new Error('boom');
		});
		expect(() => disposeAll()).not.toThrow();
		expect(fn).toHaveBeenCalledOnce();
		expect(logged).toHaveBeenCalledOnce();
	});

	// The two contracts meet here. Dropping only the disposers that returned cleanly satisfies "runs
	// every disposer" and "keeps going when one throws" on their own, and still retries the thrower on
	// the next teardown -- which for a disposer that half-completed is the run that does real damage.
	it('does not retry a disposer that threw', () => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		const thrower = vi.fn(() => {
			throw new Error('boom');
		});
		registerDisposer(thrower);
		disposeAll();
		disposeAll();
		expect(thrower).toHaveBeenCalledOnce();
	});
});
