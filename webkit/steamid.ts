import { accountIdToSteamId64 } from '../shared/steamid';

interface ProfileWindow {
	g_rgProfileData?: { steamid64?: unknown; steamid?: unknown };
}

/**
 * Steam populates g_rgProfileData per page with the *viewed* profile's data, so it is the only
 * global worth trusting here. The cast is deliberately defensive: win is whatever the community
 * browser handed us, so a null, a primitive, or a missing global all have to fall through rather
 * than throw.
 */
function fromProfileGlobals(win: unknown): string | null {
	const data = (win as ProfileWindow | undefined)?.g_rgProfileData;
	for (const candidate of [data?.steamid64, data?.steamid]) {
		if (typeof candidate !== 'string') continue;
		const value = candidate.trim();
		if (value && value !== '0') return value;
	}
	return null;
}

/**
 * data-miniprofile carries Steam's 32-bit account id. accountIdToSteamId64 rejects anything outside
 * 1..4294967295, including '0' and its padded forms, so a non-null result is a real account.
 */
function fromMiniprofile(doc: Document): string | null {
	const accountId = doc.querySelector('[data-miniprofile]')?.getAttribute('data-miniprofile');
	return accountId ? accountIdToSteamId64(accountId.trim()) : null;
}

/**
 * Last resort: ask the profile page for its own ?xml=1 view. Everything is inside the try because a
 * failed request must read as "unknown profile", not as an exception escaping into the caller — and
 * an escaping rejection here would surface as an unhandled promise rejection, not a handled miss.
 */
async function fromProfileXml(doc: Document): Promise<string | null> {
	try {
		const href = doc.location?.href ?? '';
		if (!href) return null;
		const xmlUrl = `${href.replace(/[?#].*/, '').replace(/\/$/, '')}/?xml=1`;
		const response = await fetch(xmlUrl);
		if (!response.ok) return null;
		const parsed = new DOMParser().parseFromString(await response.text(), 'application/xml');
		const value = parsed.querySelector('steamID64')?.textContent?.trim();
		return value && value !== '0' ? value : null;
	} catch {
		return null;
	}
}

/**
 * Resolve the SteamID64 of the profile currently being viewed.
 *
 * Never read window.g_steamID here — that is the signed-in user's id, not the profile on screen,
 * and using it would point every button at the viewer. The failure would hide, too: your own
 * profile page would still look correct while every other profile silently linked to your stats.
 */
export async function resolveProfileSteamId(doc: Document, win: unknown): Promise<string | null> {
	return fromProfileGlobals(win) ?? fromMiniprofile(doc) ?? (await fromProfileXml(doc));
}
