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
 * Both halves are load-bearing. The kind check alone would accept /id/<vanity>/friends/, whose
 * avatars are other people. The segment count alone would accept /groups/<name>/ and /app/<id>/,
 * which are also two segments but are not profiles at all.
 */
function isProfileRoot(doc: Document): boolean {
	const href = hrefOf(doc);
	if (parseLookupInput(href).kind === 'invalid') return false;
	try {
		return new URL(href).pathname.split('/').filter(Boolean).length === 2;
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
 * data-miniprofile carries Steam's 32-bit account id.
 *
 * The selector is document-wide and takes the first match in document order, so this may only run
 * once the caller has established the document is a single profile's own root. The attribute also
 * decorates friend-list, comment-thread and group-member avatars, and on any other community page
 * the first match is a stranger -- a range-valid, entirely plausible id for the wrong account.
 */
function fromMiniprofile(doc: Document): string | null {
	const accountId = doc.querySelector('[data-miniprofile]')?.getAttribute('data-miniprofile');
	return accountId ? accountIdToSteamId64(accountId.trim()) : null;
}

/**
 * Last resort: ask the profile page for its own ?xml=1 view. Everything is inside the try because a
 * failed request must read as "unknown profile", not as an exception escaping into the caller -- and
 * an escaping rejection here would surface as an unhandled promise rejection, not a handled miss.
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
 * Resolve the SteamID64 of the profile currently being viewed, or null if this page is not showing
 * one. Every branch is range-checked, so a non-null result is always a well-formed SteamID64 in the
 * individual-account interval.
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

	// The two remaining branches read whatever the page, or its ?xml=1 view, happens to contain, so
	// they only run where the document is known to be one profile's own root. Off a profile root
	// there is no viewed profile to resolve, and null is the honest answer rather than a guess.
	if (!isProfileRoot(doc)) return null;

	return fromMiniprofile(doc) ?? (await fromProfileXml(doc));
}
