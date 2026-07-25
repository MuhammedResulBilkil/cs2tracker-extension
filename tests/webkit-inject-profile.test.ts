import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PROFILE_CONTAINER_CLASS, injectProfileButton, removeProfileButton } from '../webkit/inject-profile';

const PROFILE_WINDOW = { g_rgProfileData: { steamid: '76561198145891996' } };

function setupProfilePage(): Element {
	document.body.innerHTML = `
		<div class="profile_rightcol">
			<div class="persona"></div>
			<div class="responsive_status_info"></div>
		</div>`;
	return document.querySelector('.profile_rightcol')!;
}

beforeEach(() => {
	document.head.innerHTML = '';
	document.body.innerHTML = '';
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('injectProfileButton', () => {
	it('inserts a link to the correct CS2Tracker profile', async () => {
		setupProfilePage();
		await expect(injectProfileButton(document, PROFILE_WINDOW, false)).resolves.toBe(true);

		const link = document.querySelector('a.cs2tracker-btn') as HTMLAnchorElement;
		expect(link).not.toBeNull();
		expect(link.getAttribute('href')).toBe('https://cs2tracker.gg/stats/76561198145891996');
		expect(link.textContent).toContain('CS2Tracker.gg');
	});

	it('uses the external URL scheme when openExternal is on', async () => {
		setupProfilePage();
		await injectProfileButton(document, PROFILE_WINDOW, true);
		expect(document.querySelector('a.cs2tracker-btn')!.getAttribute('href')).toBe(
			'steam://openurl_external/https://cs2tracker.gg/stats/76561198145891996',
		);
	});

	it('inserts the container as the second child of the right column', async () => {
		const column = setupProfilePage();
		await injectProfileButton(document, PROFILE_WINDOW, false);
		expect(column.children[1].classList.contains(PROFILE_CONTAINER_CLASS)).toBe(true);
	});

	it('injects the stylesheet', async () => {
		setupProfilePage();
		await injectProfileButton(document, PROFILE_WINDOW, false);
		expect(document.getElementById('cs2tracker-extension-style')).not.toBeNull();
	});

	it('is idempotent', async () => {
		setupProfilePage();
		await injectProfileButton(document, PROFILE_WINDOW, false);
		await expect(injectProfileButton(document, PROFILE_WINDOW, false)).resolves.toBe(false);
		expect(document.querySelectorAll('a.cs2tracker-btn')).toHaveLength(1);
	});

	it('does nothing when the right column is absent', async () => {
		document.body.innerHTML = '<div class="something_else"></div>';
		await expect(injectProfileButton(document, PROFILE_WINDOW, false)).resolves.toBe(false);
		expect(document.querySelector('a.cs2tracker-btn')).toBeNull();
	});

	it('removes its placeholder when the SteamID cannot be resolved', async () => {
		vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
		setupProfilePage();
		await expect(injectProfileButton(document, {}, false)).resolves.toBe(false);
		expect(document.querySelector(`.${PROFILE_CONTAINER_CLASS}`)).toBeNull();
	});

	/**
	 * The contract is "true only when a button was actually added", and the await is where that can stop
	 * being true. Teardown -- the plugin being disabled, or Steam re-rendering the sidebar -- detaches the
	 * reserved container while the SteamID lookup is still in flight, and the code after the await would
	 * then build the button inside a node that is no longer in the document.
	 *
	 * removeProfileButton is called synchronously on the promise's own turn, so it lands strictly before
	 * the await resumes: injectProfileButton runs to the await, yields, and only then is the resumption
	 * queued as a microtask. That makes the race deterministic here rather than something the test hopes
	 * to hit. Both halves are asserted, because a detached button is invisible either way -- returning
	 * true is the part that lies, and the part a retry loop reads.
	 */
	it('reports failure when teardown detaches its container mid-injection', async () => {
		setupProfilePage();
		const pending = injectProfileButton(document, PROFILE_WINDOW, false);
		removeProfileButton(document);
		await expect(pending).resolves.toBe(false);
		expect(document.querySelector('a.cs2tracker-btn')).toBeNull();
	});

	/**
	 * The mirror of the placeholder case, and the reason ensureStyles sits *after* the resolution guard
	 * rather than before it. Hoisting that one call above the guard passes every other test in this
	 * file, so without this assertion the ordering is unpinned -- and the sheet is not inert: it
	 * declares position:relative on Steam's own .friend_block_v2, which re-anchors any absolutely
	 * positioned descendant Steam already has in a friend row. A page this module declines to touch
	 * must be left exactly as it was found, container and stylesheet both.
	 */
	it('does not style a document it declines to touch', async () => {
		vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
		setupProfilePage();
		await injectProfileButton(document, {}, false);
		expect(document.getElementById('cs2tracker-extension-style')).toBeNull();
	});
});

describe('removeProfileButton', () => {
	it('removes the container', async () => {
		setupProfilePage();
		await injectProfileButton(document, PROFILE_WINDOW, false);
		removeProfileButton(document);
		expect(document.querySelector(`.${PROFILE_CONTAINER_CLASS}`)).toBeNull();
	});

	it('is safe when nothing was injected', () => {
		expect(() => removeProfileButton(document)).not.toThrow();
	});

	/**
	 * Teardown has to be total. The case above injects exactly one container, so it is satisfied by a
	 * querySelector that removes only the first match -- and that mutation passes this whole file
	 * otherwise. Two containers is not hypothetical: the community browser navigates without a document
	 * reload, so a stale container surviving next to a fresh one leaves a button still pointing at
	 * whichever profile was on screen before. The fixture builds both directly rather than by injecting
	 * twice, because injectProfileButton's own guard makes the second injection impossible.
	 */
	it('removes every container, not just the first', () => {
		const column = setupProfilePage();
		for (let i = 0; i < 2; i++) {
			const stale = document.createElement('div');
			stale.className = `account-row ${PROFILE_CONTAINER_CLASS}`;
			column.appendChild(stale);
		}
		expect(document.querySelectorAll(`.${PROFILE_CONTAINER_CLASS}`)).toHaveLength(2);

		removeProfileButton(document);
		expect(document.querySelectorAll(`.${PROFILE_CONTAINER_CLASS}`)).toHaveLength(0);
	});
});
