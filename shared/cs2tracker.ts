export const CS2TRACKER_PROFILE_BASE = 'https://cs2tracker.gg/stats/';

/** Canonical CS2Tracker profile URL. */
export function buildProfileUrl(steamId64: string): string {
	return CS2TRACKER_PROFILE_BASE + encodeURIComponent(steamId64);
}

/**
 * href for an anchor rendered inside the Steam community browser.
 * The external form hands the URL to the system browser, which avoids
 * Cloudflare challenges that the embedded browser can trip.
 */
export function buildProfileHref(steamId64: string, openExternal: boolean): string {
	const url = buildProfileUrl(steamId64);
	return openExternal ? `steam://openurl_external/${url}` : url;
}

/** Argument for SteamClient.URL.ExecuteSteamURL, called from Steam's UI. */
export function buildSteamUrlCommand(steamId64: string, openExternal: boolean): string {
	return `steam://openurl${openExternal ? '_external' : ''}/${buildProfileUrl(steamId64)}`;
}
