import { buildProfileHref } from '../shared/cs2tracker';
import { createIcon } from './icon';
import { resolveProfileSteamId } from './steamid';
import { ensureStyles } from './styles';

/**
 * Marks the wrapper this module owns. It is the idempotency key and the teardown key both, so it has
 * to be specific enough that nothing Steam ships collides with it.
 */
export const PROFILE_CONTAINER_CLASS = 'cs2tracker-extension-container';

/**
 * Steam's profile sidebar, and the only anchor this module injects into.
 *
 * Exported because the entry has to wait for this exact element before calling in, and a second copy of the
 * literal fails silently in both directions: if the waiter's selector is the stale one it fires on an element
 * this module will not accept and injection answers false, and if this one is stale the waiter never fires and
 * injection is never attempted. Neither shows up as an error. Same reason PROFILE_CONTAINER_CLASS is exported.
 */
export const PROFILE_COLUMN_SELECTOR = '.profile_rightcol';

/**
 * The wordmark, split so the middle word can be coloured. Concatenated they are the button's whole
 * accessible name, so the split must not change what that name says -- a test pins
 * LABEL_PREFIX + LABEL_ACCENT + LABEL_SUFFIX against BUTTON_LABEL for exactly that reason.
 */
const LABEL_PREFIX = 'CS2';
const LABEL_ACCENT = 'Tracker';
const LABEL_SUFFIX = '.gg';
const BUTTON_LABEL = `${LABEL_PREFIX}${LABEL_ACCENT}${LABEL_SUFFIX}`;

/**
 * Add the CS2Tracker button to a Steam community profile page.
 * Returns true only when a button was actually added.
 *
 * The return value is the signal a retry loop reads, so "false" has to mean "nothing of ours is in the
 * document" for every one of its reasons -- no column yet, already injected, unknown profile, the slot
 * detached while we were resolving, or something threw -- and never "added, probably". Equally, the
 * promise does not reject: a rejection would be a sixth outcome meaning the opposite of the other five.
 */
export async function injectProfileButton(doc: Document, win: unknown, openExternal: boolean): Promise<boolean> {
	const column = doc.querySelector(PROFILE_COLUMN_SELECTOR);
	if (!column) return false;
	if (column.querySelector(`.${PROFILE_CONTAINER_CLASS}`)) return false;

	// Reserve the slot before the async lookup so the button cannot land in the wrong position if Steam
	// finishes rendering the column while we wait. It also closes the re-entrancy window: the guard
	// above is what makes a second call during the same await return false instead of injecting twice.
	const container = doc.createElement('div');
	container.className = `account-row ${PROFILE_CONTAINER_CLASS}`;
	column.insertBefore(container, column.children[1] ?? null);

	try {
		return await buildButton(doc, win, openExternal, container);
	} catch (error) {
		// buildButton runs with the container already in the page, so a throw inside it used to reject with
		// an empty account-row still in Steam's sidebar -- and the guard above would then read that
		// leftover as "already injected" and refuse every later attempt on the page. Unwinding exactly as
		// an unresolved SteamID does is what keeps the docblock's promise true for this outcome too. The
		// realistic source is `new DOMParser()` in createIcon, which sits outside that module's null guards
		// and so throws rather than returning null on a host without it.
		//
		// The stylesheet is deliberately not torn down here. It is shared with the friend-row badges, so
		// removing it could unstyle an injection that has nothing to do with this failure.
		console.error('[CS2Tracker] Profile button injection failed:', error);
		container.remove();
		return false;
	}
}

/**
 * The half that runs with a container already in the document. Split out so the caller's try/catch has
 * one obvious span rather than wrapping the guards that must not be caught -- a missing column and an
 * already-injected page are answers, not failures.
 */
async function buildButton(
	doc: Document,
	win: unknown,
	openExternal: boolean,
	container: Element,
): Promise<boolean> {
	const steamId = await resolveProfileSteamId(doc, win);
	if (!steamId) {
		// The reserved slot has to go back, and the reason that outranks appearance is the guard above:
		// a container left behind reads as "already injected", so every later retry on that page --
		// including the one after Steam finishes populating g_rgProfileData -- refuses to run. The
		// cosmetic cost is real too, since the container carries Steam's own account-row class and is
		// therefore not guaranteed to collapse to nothing in the sidebar.
		container.remove();
		return false;
	}

	// The container was in the document when we reserved it; the await is where that can stop being true.
	// A teardown, or Steam re-rendering the sidebar, detaches it while the lookup is in flight, and
	// everything below would then build the button inside an orphan and report success for a button
	// nobody can see. Returning false is also what lets a caller's retry try again against the new
	// column, which reporting success would have talked it out of.
	if (!container.isConnected) return false;

	// After the guard, not before: a page that resolves to nothing gets no button, so it has no use for
	// the stylesheet either -- and the sheet declares position:relative on Steam's own .friend_block_v2,
	// which is not a change worth making on a page this module is about to leave alone.
	ensureStyles(doc);

	// An anchor with an href, deliberately -- not a div with a click handler. That is what makes the
	// button tab-reachable, focusable and openable with Enter without a line of code, and Steam's own
	// middle-click and context-menu behaviour comes with it.
	const link = doc.createElement('a');
	link.className = 'cs2tracker-btn';
	link.href = buildProfileHref(steamId, openExternal);
	link.title = `${BUTTON_LABEL} — view CS2 stats`;

	// createIcon returns null when the markup will not parse. A label with no icon is degraded but
	// still a working button, so the icon is optional and the label is not: the icon is aria-hidden,
	// which leaves the label as the button's entire accessible name.
	const icon = createIcon(doc, 'cs2tracker-btn__icon');
	if (icon) link.appendChild(icon);

	// The wordmark is three nodes rather than one string so the middle word can carry the brand colour,
	// the way CSStats.gg colours "stats" inside "CSstats.gg". Built with createTextNode and textContent
	// rather than innerHTML: the store's review rejects interpolated innerHTML on sight, and there is no
	// reason to reach for it when the parts are known at build time.
	//
	// The stylesheet uppercases these, so they are written in natural case here. That matters for the
	// accessible name, which is the concatenation of all three and reads as "CS2Tracker.gg" to a screen
	// reader rather than as shouting.
	const label = doc.createElement('span');
	label.appendChild(doc.createTextNode(LABEL_PREFIX));

	const accent = doc.createElement('span');
	accent.className = 'cs2tracker-btn__accent';
	accent.textContent = LABEL_ACCENT;
	label.appendChild(accent);

	label.appendChild(doc.createTextNode(LABEL_SUFFIX));
	link.appendChild(label);

	container.appendChild(link);
	return true;
}

/**
 * Undo injectProfileButton. Safe on a document that was never injected.
 *
 * querySelectorAll, not querySelector: teardown has to be total. Steam can navigate the community
 * browser without a document reload, so if a stale container ever survives alongside a fresh one,
 * removing only the first leaves a button pointing at whichever profile was on screen before.
 */
export function removeProfileButton(doc: Document): void {
	doc.querySelectorAll(`.${PROFILE_CONTAINER_CLASS}`).forEach((node) => node.remove());
}
