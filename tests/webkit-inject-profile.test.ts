import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PROFILE_CONTAINER_CLASS, injectProfileButton, removeProfileButton } from '../webkit/inject-profile';

const PROFILE_WINDOW = { g_rgProfileData: { steamid: '76561198145891996' } };

/** Takes the target document so the two-document cases can build the same fixture somewhere else. */
function setupProfilePage(doc: Document = document): Element {
	doc.body.innerHTML = `
		<div class="profile_rightcol">
			<div class="persona"></div>
			<div class="responsive_status_info"></div>
		</div>`;
	return doc.querySelector('.profile_rightcol')!;
}

/**
 * For the two cases whose SteamID never resolves. Neither one actually reaches the network, and that is
 * worth stating because the shape of the test suggests otherwise: happy-dom's ambient location is
 * http://localhost:3000/, which resolveProfileSteamId classifies as "not a profile root", so it returns
 * null at that gate and never gets as far as its ?xml=1 fallback. Measured at zero fetch calls, not
 * assumed. So this stub is inert today, and the ?xml=1 branch is covered by tests/webkit-steamid.test.ts
 * rather than here.
 *
 * It is kept for the reason that file documents at length: happy-dom's own fetch prints a cross-origin
 * warning even when the rejection is caught, so an unstubbed reach pollutes the output without failing
 * anything. If the ambient location or the resolution order ever changes, this is what keeps these two
 * tests quiet instead of noisy.
 */
const stubOfflineFetch = () => vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));

/** The parser stub from tests/webkit-icon.test.ts, which is the only way to make createIcon return null. */
function stubBrokenParser(): void {
	const broken = new DOMParser().parseFromString('<svg><path d="M0 0"></svg>', 'image/svg+xml');
	expect(broken.documentElement.querySelector('parsererror')).not.toBeNull();
	vi.stubGlobal(
		'DOMParser',
		class {
			parseFromString() {
				return broken;
			}
		},
	);
}

beforeEach(() => {
	document.head.innerHTML = '';
	document.body.innerHTML = '';
});

// restoreAllMocks as well as unstubAllGlobals: the throwing case silences console.error and the
// two-document case spies on the ambient document's importNode, and either spy left installed would
// distort whatever test ran next.
afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
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
		stubOfflineFetch();
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
		stubOfflineFetch();
		setupProfilePage();
		await injectProfileButton(document, {}, false);
		expect(document.getElementById('cs2tracker-extension-style')).toBeNull();
	});

	/**
	 * createIcon returns null when the icon markup will not parse, and the contract for that is "degraded
	 * but usable" -- a text-labelled button with no icon, never an abort. Nothing pinned it: mutating the
	 * guard to `if (!icon) return false;`, which is exactly the abort the spec forbids, passed this entire
	 * file, because the icon is built from a static constant that always parses under happy-dom. Forcing
	 * the null needs no module mock, only the parser stub tests/webkit-icon.test.ts already uses.
	 *
	 * The label is asserted alongside the missing icon because the icon is aria-hidden: the label is the
	 * button's entire accessible name, so a button that lost both would be unreachable rather than plain.
	 */
	it('keeps a usable button when the icon cannot be built', async () => {
		stubBrokenParser();
		setupProfilePage();

		await expect(injectProfileButton(document, PROFILE_WINDOW, false)).resolves.toBe(true);
		const link = document.querySelector('a.cs2tracker-btn');
		expect(link).not.toBeNull();
		expect(link!.textContent).toContain('CS2Tracker.gg');
		expect(link!.querySelector('.cs2tracker-btn__icon')).toBeNull();
	});

	/**
	 * The container is inserted before the SteamID lookup is awaited, so a throw anywhere after that point
	 * used to reject with an empty account-row still in Steam's sidebar -- and the idempotency guard would
	 * then read that leftover as "already injected" and refuse every later attempt on the page. The
	 * realistic source is `new DOMParser()` in createIcon, which sits outside that module's null guards
	 * and so throws rather than returning null on a host that lacks it. Blink has DOMParser, so this is
	 * remote; the point is that rejection was a fifth outcome meaning the opposite of the other four.
	 *
	 * The retry at the end is the real assertion, because unwinding only matters if it leaves the page
	 * injectable again. The console spy keeps the suite's output clean and doubles as the check that the
	 * failure is reported rather than silently swallowed.
	 */
	it('unwinds and stays retryable when injection throws', async () => {
		const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
		vi.stubGlobal(
			'DOMParser',
			class {
				constructor() {
					throw new Error('no DOMParser on this host');
				}
			},
		);
		setupProfilePage();

		await expect(injectProfileButton(document, PROFILE_WINDOW, false)).resolves.toBe(false);
		expect(document.querySelector(`.${PROFILE_CONTAINER_CLASS}`)).toBeNull();
		expect(logged).toHaveBeenCalledOnce();

		vi.unstubAllGlobals();
		await expect(injectProfileButton(document, PROFILE_WINDOW, false)).resolves.toBe(true);
	});

	/**
	 * Every other case here passes the ambient document, which leaves all of this module's `doc` uses
	 * satisfied by the global `document` and therefore unpinned -- swapping any one of them keeps the file
	 * green. Not hypothetical: webkit/styles.ts documents that this bundle runs against a separate
	 * document per community page, which is what the entry point will hand in, and webkit/icon.ts
	 * documents that a node built against the wrong document throws WrongDocumentError on insert in a real
	 * browser. Both sibling modules already have this test; it was not carried over.
	 *
	 * The importNode spy is what pins createIcon's argument specifically, and it is a spy rather than a
	 * DOM assertion for a measured reason: happy-dom adopts a foreign node on insert, recursively and
	 * without throwing, so with createIcon(document, ...) the icon and all five of its paths still report
	 * `other` once appended. Adoption launders every ownerDocument downstream, so which document was
	 * asked to build the node is the only thing left to observe.
	 */
	it('operates on the document it is given, not the ambient one', async () => {
		const other = document.implementation.createHTMLDocument('other');
		const column = setupProfilePage(other);
		const ambientImportNode = vi.spyOn(document, 'importNode');

		await expect(injectProfileButton(other, PROFILE_WINDOW, false)).resolves.toBe(true);

		const link = other.querySelector('a.cs2tracker-btn');
		expect(link).not.toBeNull();
		expect(link!.ownerDocument).toBe(other);
		expect(link!.querySelector('.cs2tracker-btn__icon')).not.toBeNull();
		expect(column.children[1].classList.contains(PROFILE_CONTAINER_CLASS)).toBe(true);
		expect(other.getElementById('cs2tracker-extension-style')).not.toBeNull();
		expect(ambientImportNode).not.toHaveBeenCalled();

		expect(document.querySelector('a.cs2tracker-btn')).toBeNull();
		expect(document.querySelector(`.${PROFILE_CONTAINER_CLASS}`)).toBeNull();
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

	/**
	 * The mirror of the injector's two-document case, and the sibling module records this exact mutation
	 * surviving a whole suite: tests/webkit-styles.test.ts notes that removeStyles reading the ambient
	 * document instead of the one it was handed passed every test until a two-document case was added.
	 * Teardown stripping the wrong page's button is the same defect one module over.
	 */
	it('removes from the document it is given and leaves the others alone', async () => {
		const other = document.implementation.createHTMLDocument('other');
		setupProfilePage();
		setupProfilePage(other);
		await injectProfileButton(document, PROFILE_WINDOW, false);
		await injectProfileButton(other, PROFILE_WINDOW, false);

		removeProfileButton(other);
		expect(other.querySelector(`.${PROFILE_CONTAINER_CLASS}`)).toBeNull();
		expect(document.querySelector(`.${PROFILE_CONTAINER_CLASS}`)).not.toBeNull();
	});
});
