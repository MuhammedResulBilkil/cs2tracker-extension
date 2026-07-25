/**
 * Cleanup registered by the injectors, newest last. A MutationObserver left connected outlives the
 * page it was watching and keeps rewriting the DOM, so every observer and timer this bundle starts
 * belongs here.
 */
const disposers: Array<() => void> = [];

/** Register cleanup to run when the page goes away or injection is torn down. */
export function registerDisposer(dispose: () => void): void {
	disposers.push(dispose);
}

/**
 * Run every disposer once, most recent first. Never throws.
 *
 * Most recent first because disposal unwinds construction: an observer registered after the element it
 * watches has to stop watching before that element is removed.
 *
 * Each disposer is popped off the list *before* it is called, which is what makes "at most once" hold
 * even for one that throws. Dropping only the ones that returned cleanly would leave a thrower queued
 * for the next teardown -- and a disposer that failed half way through is exactly the one that must
 * not run again. The try/catch sits inside the loop for the same reason: one failure must not strand
 * every disposer registered before it.
 */
export function disposeAll(): void {
	while (disposers.length > 0) {
		const dispose = disposers.pop();
		try {
			dispose?.();
		} catch (error) {
			console.error('[CS2Tracker] Disposer failed:', error);
		}
	}
}
