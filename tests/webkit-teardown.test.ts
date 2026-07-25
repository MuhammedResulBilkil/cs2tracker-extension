import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FRIEND_BADGE_CLASS, observeFriendBlocks } from '../webkit/inject-friendblocks';
import { PROFILE_COLUMN_SELECTOR, PROFILE_CONTAINER_CLASS, injectProfileButton } from '../webkit/inject-profile';
import { disposeAll, registerDisposer } from '../webkit/lifecycle';
import { STYLE_ELEMENT_ID } from '../webkit/styles';
import { teardown } from '../webkit/teardown';

/**
 * teardown() is the function the store review cares most about, and neither mistake it can make fails loudly.
 * Move disposeAll past the removals and the plugin still works on every page it was switched on for; drop the
 * removeStyles line and every page it touched keeps a change to Steam's own row layout forever. Before this
 * file existed both mutations passed the entire suite, and the only evidence for the chain being complete was
 * a reading of minified bundle output, which is not a regression test.
 *
 * It is reachable at all because it lives in its own module. It needs nothing from Steam -- four removers and
 * a Document -- and was untestable only while it shared a file with the entry's @steambrew/webkit import.
 */

const PROFILE_WINDOW = { g_rgProfileData: { steamid: '76561198145891996' } };

/** Steam's profile sidebar and two friend rows in one document, which is what a real teardown has to face. */
function injectedPage(): string {
	return `
		<div class="${PROFILE_COLUMN_SELECTOR.slice(1)}">
			<div class="persona"></div>
			<div class="responsive_status_info"></div>
		</div>
		<div class="friend_block_v2" data-steamid="76561198145891996"></div>
		<div class="friend_block_v2" data-steamid="76561198314937074"></div>`;
}

/**
 * Build the full injected state: button, badges, markers and stylesheet, with the friend-block observer
 * running. Asserts its own preconditions, because a teardown test that starts from an empty page passes for
 * every possible teardown including one that does nothing.
 */
async function injectEverything(): Promise<void> {
	document.body.innerHTML = injectedPage();
	await expect(injectProfileButton(document, PROFILE_WINDOW, false)).resolves.toBe(true);
	observeFriendBlocks(document, false);

	expect(document.querySelector(`.${PROFILE_CONTAINER_CLASS}`)).not.toBeNull();
	expect(document.querySelectorAll(`a.${FRIEND_BADGE_CLASS}`)).toHaveLength(2);
	expect(document.querySelectorAll('[data-cs2tracker-injected]')).toHaveLength(2);
	expect(document.getElementById(STYLE_ELEMENT_ID)).not.toBeNull();
}

beforeEach(() => {
	disposeAll();
	document.head.innerHTML = '';
	document.body.innerHTML = '';
});

afterEach(() => {
	disposeAll();
	vi.restoreAllMocks();
});

describe('teardown', () => {
	/**
	 * One test, four assertions, because "complete" is the property and any subset of it passes for a
	 * teardown that forgets a line. The marker assertion is not tidiness: inject-friendblocks.ts skips every
	 * row that still carries one, so a page left marked is permanently un-badgeable and looks clean while
	 * being unrecoverable.
	 */
	it('removes the button, the badges, the markers and the stylesheet', async () => {
		await injectEverything();

		teardown(document);

		expect(document.querySelector(`.${PROFILE_CONTAINER_CLASS}`)).toBeNull();
		expect(document.querySelectorAll(`a.${FRIEND_BADGE_CLASS}`)).toHaveLength(0);
		expect(document.querySelectorAll('[data-cs2tracker-injected]')).toHaveLength(0);
		expect(document.getElementById(STYLE_ELEMENT_ID)).toBeNull();
	});

	/**
	 * The stylesheet gets its own case as well as its line in the sweep above, because it is the one Task 8
	 * explicitly handed this function and the one whose absence is invisible on screen. `.friend_block_v2
	 * {position:relative}` makes every friend row the containing block for Steam's own absolutely positioned
	 * row descendants, so a sheet left behind is a change to Steam's layout on a page with nothing of ours
	 * left in it. Neither remover drops it -- each declines in case the other still needs it -- so this
	 * function is the only place it can go.
	 */
	it('drops the stylesheet that neither remover will touch', async () => {
		await injectEverything();

		teardown(document);

		expect(document.getElementById(STYLE_ELEMENT_ID)).toBeNull();
	});

	it('runs the registered disposers', async () => {
		await injectEverything();
		const disposer = vi.fn();
		registerDisposer(disposer);

		teardown(document);

		expect(disposer).toHaveBeenCalledOnce();
	});

	/**
	 * The ordering test, and the only thing in the repository that fails when disposeAll is moved past the
	 * removals.
	 *
	 * It observes from inside a disposer, because that is the one moment the order is visible. Nothing in the
	 * DOM can see it: teardown is synchronous, MutationObserver callbacks are not, and disconnect() drops the
	 * pending queue, so a friend-block observer left connected through the removals cannot in fact re-badge
	 * anything -- and inject-friendblocks.ts skips a removal-only batch regardless. So this pins the invariant
	 * rather than a currently observable difference, deliberately: both of the facts that make the wrong order
	 * survive today live in other modules, neither is written down as a guarantee, and teardown cannot see
	 * either of them.
	 */
	it('stops the observers before it removes anything', async () => {
		await injectEverything();

		let buttonPresent = false;
		let badgesPresent = false;
		let stylesPresent = false;
		registerDisposer(() => {
			buttonPresent = document.querySelector(`.${PROFILE_CONTAINER_CLASS}`) !== null;
			badgesPresent = document.querySelector(`a.${FRIEND_BADGE_CLASS}`) !== null;
			stylesPresent = document.getElementById(STYLE_ELEMENT_ID) !== null;
		});

		teardown(document);

		expect(buttonPresent).toBe(true);
		expect(badgesPresent).toBe(true);
		expect(stylesPresent).toBe(true);
	});

	/**
	 * The friend-block observer re-badges every row the next time Steam adds a node, so leaving it connected
	 * turns teardown into a pause. disposeAll is what disconnects it, and this is the end-to-end version of
	 * that: tear down, then mutate the page the way Steam would, and nothing may come back.
	 */
	it('leaves nothing behind that can re-inject after Steam mutates the page', async () => {
		await injectEverything();

		teardown(document);
		document.body.appendChild(document.createElement('div'));
		await new Promise((resolve) => setTimeout(resolve, 20));

		expect(document.querySelectorAll(`a.${FRIEND_BADGE_CLASS}`)).toHaveLength(0);
		expect(document.getElementById(STYLE_ELEMENT_ID)).toBeNull();
	});

	it('is safe on a document that was never injected', () => {
		document.body.innerHTML = '<div class="friend_block_v2" data-steamid="76561198145891996"></div>';

		expect(() => teardown(document)).not.toThrow();
		expect(document.querySelector('.friend_block_v2')).not.toBeNull();
		expect(document.getElementById(STYLE_ELEMENT_ID)).toBeNull();
	});

	it('is safe to run twice', async () => {
		await injectEverything();

		teardown(document);
		expect(() => teardown(document)).not.toThrow();

		expect(document.querySelector(`.${PROFILE_CONTAINER_CLASS}`)).toBeNull();
		expect(document.querySelectorAll(`a.${FRIEND_BADGE_CLASS}`)).toHaveLength(0);
		expect(document.getElementById(STYLE_ELEMENT_ID)).toBeNull();
	});
});
