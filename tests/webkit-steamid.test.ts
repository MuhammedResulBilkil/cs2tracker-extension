import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveProfileSteamId } from '../webkit/steamid';

/** The profile under test, and the account id that converts to it. */
const VIEWED = '76561198145891996';
const VIEWED_MINIPROFILE = '185626268';

/** A different, in-range SteamID64 used wherever a wrong answer has to be distinguishable. */
const OTHER = '76561198000000123';

/** Account ids belonging to other people, as a friend list or comment thread would carry them. */
const STRANGER_AVATARS =
	'<div class="friend_block_v2" data-miniprofile="39734272"></div>' +
	'<div class="friend_block_v2" data-miniprofile="1"></div>';
const VIEWED_AVATAR = `<div class="playerAvatar" data-miniprofile="${VIEWED_MINIPROFILE}"></div>`;

const PROFILE_HREF = `https://steamcommunity.com/profiles/${VIEWED}/`;
const VANITY_HREF = 'https://steamcommunity.com/id/intkira/';
const VANITY_SUBPAGE_HREF = 'https://steamcommunity.com/id/intkira/friends/';

/**
 * The default href is the vanity form on purpose. A /profiles/<id>/ href carries the answer in the
 * URL, so it would satisfy almost every assertion here through the first branch alone and leave the
 * later branches untested.
 */
function makeDocument(html: string, href = VANITY_HREF): Document {
	const doc = document.implementation.createHTMLDocument('test');
	doc.body.innerHTML = html;
	Object.defineProperty(doc, 'location', { value: { href }, configurable: true });
	return doc;
}

const xmlFor = (steamId: string) => `<?xml version="1.0"?><profile><steamID64>${steamId}</steamID64></profile>`;

/**
 * Every test stubs fetch, even the ones that must never reach it. happy-dom's own fetch rejects
 * same-origin-blocked and prints a cross-origin warning even when the rejection is caught, so a test
 * that reaches the network unstubbed pollutes the output without failing. Stubbing everywhere means
 * `not.toHaveBeenCalled()` is what proves a branch short-circuited.
 */
const stubFetch = (response: unknown) => {
	const mock = vi.fn().mockResolvedValue(response);
	vi.stubGlobal('fetch', mock);
	return mock;
};
const stubOkXml = (steamId: string) => stubFetch({ ok: true, text: async () => xmlFor(steamId) });
const stubNotOk = () => stubFetch({ ok: false, text: async () => '' });

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('resolveProfileSteamId', () => {
	describe('1. the profile URL', () => {
		it('reads the SteamID64 straight out of a /profiles/ URL', async () => {
			const fetchMock = stubNotOk();
			await expect(resolveProfileSteamId(makeDocument('', PROFILE_HREF), {})).resolves.toBe(VIEWED);
			expect(fetchMock).not.toHaveBeenCalled();
		});

		// The URL is what the browser is actually showing, so it outranks a global that disagrees.
		it('prefers the URL over a conflicting g_rgProfileData', async () => {
			const fetchMock = stubNotOk();
			const win = { g_rgProfileData: { steamid64: OTHER, steamid: OTHER } };
			await expect(resolveProfileSteamId(makeDocument('', PROFILE_HREF), win)).resolves.toBe(VIEWED);
			expect(fetchMock).not.toHaveBeenCalled();
		});

		// A friends page is full of other people's miniprofiles and has none for its owner. The URL
		// still names the owner, which is the whole reason it has to be consulted first.
		it('resolves the page owner on a /profiles/ subpage full of other people', async () => {
			const fetchMock = stubNotOk();
			const doc = makeDocument(STRANGER_AVATARS, `https://steamcommunity.com/profiles/${VIEWED}/friends/`);
			await expect(resolveProfileSteamId(doc, {})).resolves.toBe(VIEWED);
			expect(fetchMock).not.toHaveBeenCalled();
		});

		it('ignores a /profiles/ URL whose id is outside the Steam range', async () => {
			const fetchMock = stubNotOk();
			const doc = makeDocument(STRANGER_AVATARS, 'https://steamcommunity.com/profiles/12345678901234567/');
			await expect(resolveProfileSteamId(doc, {})).resolves.toBeNull();
			expect(fetchMock).not.toHaveBeenCalled();
		});
	});

	describe('2. g_rgProfileData', () => {
		it('prefers g_rgProfileData.steamid64', async () => {
			const fetchMock = stubNotOk();
			const win = { g_rgProfileData: { steamid64: VIEWED, steamid: '11111111111111111' } };
			await expect(resolveProfileSteamId(makeDocument(''), win)).resolves.toBe(VIEWED);
			expect(fetchMock).not.toHaveBeenCalled();
		});

		it('falls back to g_rgProfileData.steamid', async () => {
			const fetchMock = stubNotOk();
			const win = { g_rgProfileData: { steamid: VIEWED } };
			await expect(resolveProfileSteamId(makeDocument(''), win)).resolves.toBe(VIEWED);
			expect(fetchMock).not.toHaveBeenCalled();
		});

		// The commonest page after the profile root itself. /id/<vanity>/friends/ is not a profile
		// root, so the branches below it are gated off -- but it does carry g_rgProfileData in
		// production, and this branch has to be consulted before that gate or the owner is lost.
		// Hoist the isProfileRoot gate above this branch and this is the assertion that catches it.
		it('resolves the owner of a vanity subpage from the globals', async () => {
			const fetchMock = stubNotOk();
			const win = { g_rgProfileData: { steamid64: VIEWED } };
			const doc = makeDocument(STRANGER_AVATARS, VANITY_SUBPAGE_HREF);
			await expect(resolveProfileSteamId(doc, win)).resolves.toBe(VIEWED);
			expect(fetchMock).not.toHaveBeenCalled();
		});

		it('ignores a zero or blank profile id', async () => {
			const fetchMock = stubOkXml(VIEWED);
			const win = { g_rgProfileData: { steamid64: '0', steamid: '   ' } };
			await expect(resolveProfileSteamId(makeDocument(''), win)).resolves.toBe(VIEWED);
			expect(fetchMock).toHaveBeenCalled();
		});

		// '00' is the same "no account" value as '0', and a string compare against '0' lets it past.
		// '11111111111111111' is 17 digits but below the individual range.
		it('ignores a profile id outside the Steam range, padded zero included', async () => {
			const fetchMock = stubOkXml(VIEWED);
			const win = { g_rgProfileData: { steamid64: '00', steamid: '11111111111111111' } };
			await expect(resolveProfileSteamId(makeDocument(''), win)).resolves.toBe(VIEWED);
			expect(fetchMock).toHaveBeenCalled();
		});

		// A number cannot survive the trip: 76561198145891996 exceeds 2^53, so it would arrive as
		// 76561198145892000 -- a valid id for a different account. Skipping beats coercing.
		it('ignores a non-string profile id rather than coercing it', async () => {
			stubOkXml(VIEWED);
			const win = { g_rgProfileData: { steamid64: 76561198145891996, steamid: null } };
			await expect(resolveProfileSteamId(makeDocument(''), win)).resolves.toBe(VIEWED);
		});
	});

	describe('3. the profile XML', () => {
		it('falls back to the profile XML', async () => {
			const fetchMock = stubOkXml(VIEWED);
			await expect(resolveProfileSteamId(makeDocument(''), {})).resolves.toBe(VIEWED);
			expect(fetchMock).toHaveBeenCalledWith('https://steamcommunity.com/id/intkira/?xml=1');
		});

		// Pins the order of the last two branches, and shows why it is that way round: the page's own
		// XML cannot name anyone but the owner, while the first data-miniprofile in the document is a
		// stranger. Swap these two branches and this is the assertion that catches it.
		it('prefers the profile XML over a data-miniprofile naming someone else', async () => {
			const fetchMock = stubOkXml(VIEWED);
			await expect(resolveProfileSteamId(makeDocument(STRANGER_AVATARS), {})).resolves.toBe(VIEWED);
			expect(fetchMock).toHaveBeenCalled();
		});

		it('ignores an out-of-range id in the XML', async () => {
			stubOkXml('11111111111111111');
			await expect(resolveProfileSteamId(makeDocument(''), {})).resolves.toBeNull();
		});

		it('returns null when every strategy fails', async () => {
			vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
			await expect(resolveProfileSteamId(makeDocument(''), {})).resolves.toBeNull();
		});

		it('returns null on a non-ok XML response', async () => {
			stubNotOk();
			await expect(resolveProfileSteamId(makeDocument(''), {})).resolves.toBeNull();
		});
	});

	describe('4. data-miniprofile', () => {
		// The branch is demoted, not deleted: it is still the answer when the network is unavailable.
		it('falls back to data-miniprofile when the XML response is not ok', async () => {
			stubNotOk();
			await expect(resolveProfileSteamId(makeDocument(VIEWED_AVATAR), {})).resolves.toBe(VIEWED);
		});

		it('falls back to data-miniprofile when the XML fetch rejects', async () => {
			vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
			await expect(resolveProfileSteamId(makeDocument(VIEWED_AVATAR), {})).resolves.toBe(VIEWED);
		});

		// querySelector only ever consults the first match, so each fixture carries exactly one
		// element -- otherwise the later cases would never be reached and the names would be lying.
		it.each([
			['zero', '<div data-miniprofile="0"></div>'],
			['padded zero', '<div data-miniprofile="00"></div>'],
			['empty', '<div data-miniprofile=""></div>'],
			['non-numeric', '<div data-miniprofile="abc"></div>'],
			['out-of-range', '<div data-miniprofile="4294967296"></div>'],
		])('ignores a %s data-miniprofile', async (_label, html) => {
			stubNotOk();
			await expect(resolveProfileSteamId(makeDocument(html), {})).resolves.toBeNull();
		});

		// data-miniprofile decorates friend, comment and group-member avatars, so the first match in
		// document order on a non-profile page is a stranger. Returning null is the correct answer:
		// there is no viewed profile on a group page to resolve.
		it('is not read on a community page that is not a profile root', async () => {
			const fetchMock = stubOkXml(OTHER);
			const doc = makeDocument(STRANGER_AVATARS, 'https://steamcommunity.com/groups/somegroup/');
			await expect(resolveProfileSteamId(doc, {})).resolves.toBeNull();
			expect(fetchMock).not.toHaveBeenCalled();
		});

		// Same defect one level down: a vanity subpage has no id in the URL to save it, and with no
		// globals present there is nothing left that names the owner.
		it('is not read on a vanity subpage whose avatars are other people', async () => {
			const fetchMock = stubOkXml(OTHER);
			const doc = makeDocument(STRANGER_AVATARS, VANITY_SUBPAGE_HREF);
			await expect(resolveProfileSteamId(doc, {})).resolves.toBeNull();
			expect(fetchMock).not.toHaveBeenCalled();
		});

		// A vanity segment may hold only [A-Za-z0-9_-], but '%' terminates the vanity match and the
		// URL parser leaves %2F encoded, so the pathname still splits into two segments. Without an
		// explicit check the gate opens on what is semantically a subpage.
		it.each(['%2F', '%2f', '%5C'])('is not read when %s fakes a profile root', async (encoded) => {
			const fetchMock = stubOkXml(OTHER);
			const doc = makeDocument(STRANGER_AVATARS, `https://steamcommunity.com/id/xy${encoded}friends/`);
			await expect(resolveProfileSteamId(doc, {})).resolves.toBeNull();
			expect(fetchMock).not.toHaveBeenCalled();
		});
	});

	// window.g_steamID holds the *signed-in* user's id, never the viewed profile's. If this module
	// ever read it, every button on every page would point at the viewer, and the bug would hide
	// because the viewer's own profile still looked right. The value below is in range, so it would
	// survive validation if it leaked in at any point in the chain; every other signal is absent, so
	// a non-null answer here means it leaked.
	it("never falls back to the signed-in user's g_steamID", async () => {
		stubNotOk();
		const win = { g_steamID: OTHER, g_rgProfileData: {} };
		await expect(resolveProfileSteamId(makeDocument(''), win)).resolves.toBeNull();
	});
});
