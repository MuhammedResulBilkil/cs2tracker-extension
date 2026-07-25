import { accountIdToSteamId64, isSteamId64, parseLookupInput } from '../shared/steamid';

interface ProfileWindow {
	g_rgProfileData?: { steamid64?: unknown; steamid?: unknown };
}

function hrefOf(doc: Document): string {
	return doc.location?.href ?? '';
}

/**
 * The URL outranks every other source on a /profiles/<id>/ page: it is what the browser is actually
 * showing, it needs no network, and no element on the page can spoof it.
 *
 * parseLookupInput is the exported route to the anchored profiles pattern in shared/steamid.ts, so
 * this reuses that module's worked-out reasoning rather than restating it -- the host cannot be faked
 * by a path segment, and an 18th digit cannot be truncated into a different real account. Its
 * steamid64 result is already range-checked; isSteamId64 is repeated here so this function's
 * postcondition is stated locally instead of inherited from another module's internals.
 */
function fromProfileUrl(doc: Document): string | null {
	const target = parseLookupInput(hrefOf(doc));
	return target.kind === 'steamid64' && isSteamId64(target.value) ? target.value : null;
}

/**
 * True only on a profile's own root: /profiles/<id> or /id/<vanity>, with nothing deeper.
 *
 * Both halves of the check are load-bearing. The kind test alone would accept
 * /id/<vanity>/friends/, whose avatars are other people. The segment count alone would accept
 * /groups/<name>/ and /app/<id>/, which are also two segments but are not profiles at all.
 *
 * The encoded-separator test is the third case: a vanity segment may legally contain only
 * [A-Za-z0-9_-], but /id/xy%2Ffriends/ satisfies the vanity pattern anyway because '%' ends the
 * match, and the URL parser leaves %2F encoded rather than splitting on it. Without this the segment
 * count reads 2 and the gate opens on what is semantically a subpage.
 */
function isProfileRoot(doc: Document): boolean {
	const href = hrefOf(doc);
	if (parseLookupInput(href).kind === 'invalid') return false;
	try {
		const { pathname } = new URL(href);
		const lower = pathname.toLowerCase();
		if (lower.includes('%2f') || lower.includes('%5c')) return false;
		return pathname.split('/').filter(Boolean).length === 2;
	} catch {
		// parseLookupInput accepts a scheme-less form that the URL constructor rejects. A real
		// document.location.href is always absolute, so treating that as "not a profile root" only
		// costs the fallbacks on input this module never sees in practice.
		return false;
	}
}

/**
 * Steam populates g_rgProfileData per page with the *viewed* profile's data, so it is the only
 * global worth trusting here. The cast is deliberately defensive: win is whatever the community
 * browser handed us, so a null, a primitive, or a missing global all have to fall through.
 *
 * A non-string candidate is skipped rather than coerced. 76561198145891996 exceeds 2^53, where the
 * spacing between representable doubles is 16, so a numeric steamid64 would stringify to
 * 76561198145892000 -- a well-formed SteamID64 for somebody else. Skipping is the only safe move.
 */
function fromProfileGlobals(win: unknown): string | null {
	const data = (win as ProfileWindow | undefined)?.g_rgProfileData;
	for (const candidate of [data?.steamid64, data?.steamid]) {
		if (typeof candidate !== 'string') continue;
		const value = candidate.trim();
		if (isSteamId64(value)) return value;
	}
	return null;
}

/**
 * Ask the page for its own ?xml=1 view. On a profile root this cannot name anybody but the page
 * owner, which is what makes it authoritative enough to outrank the DOM scrape below.
 *
 * Everything is inside the try because a failed request must read as "unknown profile", not as an
 * exception escaping into the caller -- and an escaping rejection here would surface as an unhandled
 * promise rejection rather than a handled miss.
 */
async function fromProfileXml(doc: Document): Promise<string | null> {
	try {
		const href = hrefOf(doc);
		if (!href) return null;
		const xmlUrl = `${href.replace(/[?#].*/, '').replace(/\/$/, '')}/?xml=1`;
		const response = await fetch(xmlUrl);
		if (!response.ok) return null;
		const parsed = new DOMParser().parseFromString(await response.text(), 'application/xml');
		const value = parsed.querySelector('steamID64')?.textContent?.trim() ?? '';
		return isSteamId64(value) ? value : null;
	} catch {
		return null;
	}
}

/**
 * data-miniprofile carries Steam's 32-bit account id. This branch is deliberately last, and is
 * deliberately still here.
 *
 * Last, because it is the only source that can name a *different real person*. The selector takes
 * the first match in document order, and that attribute also decorates friend-list, comment-thread
 * and group-member avatars -- and, if Steam's global community header avatar carries it, the
 * signed-in viewer. That final case is the g_steamID failure the exported function warns about,
 * arrived at from the other direction: it would hide, because the viewer's own profile still looks
 * correct while every other profile lies. Every branch above is either spoof-proof or names only the
 * page owner, so this one runs only when all of them have already missed.
 *
 * Still here, because it cannot be shown unnecessary without a live Steam client. The reference
 * plugins carry it and nobody has documented why, so deleting it on reasoning alone would discard a
 * fallback that may cover a real case. Task 16 can settle it empirically; until then it is demoted,
 * not removed.
 */
function fromMiniprofile(doc: Document): string | null {
	const accountId = doc.querySelector('[data-miniprofile]')?.getAttribute('data-miniprofile');
	return accountId ? accountIdToSteamId64(accountId.trim()) : null;
}

/**
 * Resolve the SteamID64 of the profile currently being viewed, or null if this page is not showing
 * one. Every branch is range-checked, so a non-null result is always a well-formed SteamID64 in the
 * individual-account interval.
 *
 * Resolution order, most authoritative first:
 *   1. the /profiles/<id>/ URL      -- what the browser is showing; unspoofable, no network
 *   2. window.g_rgProfileData       -- Steam's own per-page data for the *viewed* profile
 *   3. the page's ?xml=1 view       -- authoritative for the page owner, but costs a round trip
 *   4. data-miniprofile            -- a DOM scrape that can name somebody else; last resort only
 *
 * Branches 3 and 4 read whatever the page happens to contain, so they run only once the document is
 * known to be one profile's own root. Off a profile root the answer is null: there is no viewed
 * profile to resolve, and null is honest where a guess would be wrong silently.
 *
 * Never read window.g_steamID here -- that is the signed-in user's id, not the profile on screen,
 * and using it would point every button at the viewer. The failure would hide, too: your own profile
 * page would still look correct while every other profile silently linked to your stats.
 */
export async function resolveProfileSteamId(doc: Document, win: unknown): Promise<string | null> {
	const fromUrl = fromProfileUrl(doc);
	if (fromUrl) return fromUrl;

	const fromGlobals = fromProfileGlobals(win);
	if (fromGlobals) return fromGlobals;

	if (!isProfileRoot(doc)) return null;

	return (await fromProfileXml(doc)) ?? fromMiniprofile(doc);
}
