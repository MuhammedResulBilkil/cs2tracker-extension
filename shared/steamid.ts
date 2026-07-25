const STEAMID64_BASE = BigInt('76561197960265728');
const STEAMID64_PATTERN = /^7656119\d{10}$/;
const VANITY_PATTERN = /^[A-Za-z0-9_-]{2,32}$/;
const PROFILES_URL_PATTERN = /steamcommunity\.com\/profiles\/(\d{17})/;
const VANITY_URL_PATTERN = /steamcommunity\.com\/id\/([A-Za-z0-9_-]{2,32})/;

export type LookupTarget =
	| { kind: 'steamid64'; value: string }
	| { kind: 'vanity'; value: string }
	| { kind: 'invalid' };

export function isSteamId64(value: string): boolean {
	return STEAMID64_PATTERN.test(value);
}

/** Steam's 32-bit account id (the `data-miniprofile` attribute) to a SteamID64. */
export function accountIdToSteamId64(accountId: string): string | null {
	if (!/^\d+$/.test(accountId) || accountId === '0') return null;
	try {
		return (STEAMID64_BASE + BigInt(accountId)).toString();
	} catch {
		return null;
	}
}

/** Classify free-form user input: a SteamID64, a profile URL, or a vanity name. */
export function parseLookupInput(raw: string): LookupTarget {
	const input = raw.trim();
	if (!input) return { kind: 'invalid' };

	const fromProfiles = input.match(PROFILES_URL_PATTERN);
	if (fromProfiles && isSteamId64(fromProfiles[1])) {
		return { kind: 'steamid64', value: fromProfiles[1] };
	}

	const fromVanityUrl = input.match(VANITY_URL_PATTERN);
	if (fromVanityUrl) return { kind: 'vanity', value: fromVanityUrl[1] };

	if (isSteamId64(input)) return { kind: 'steamid64', value: input };
	if (VANITY_PATTERN.test(input)) return { kind: 'vanity', value: input };

	return { kind: 'invalid' };
}
