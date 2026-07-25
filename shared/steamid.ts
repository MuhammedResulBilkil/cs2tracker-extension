const STEAMID64_BASE = BigInt('76561197960265728');
const STEAMID64_PATTERN = /^7656119\d{10}$/;
const VANITY_PATTERN = /^[A-Za-z0-9_-]{2,32}$/;

/** Steam account ids are unsigned 32-bit, so 1..4294967295 is the whole legal range. */
const ACCOUNT_ID_PATTERN = /^\d{1,10}$/;
const ACCOUNT_ID_MIN = BigInt(1);
const ACCOUNT_ID_MAX = BigInt('4294967295');

/*
 * Both URL patterns are anchored at both ends of the interesting segment:
 *   - `^(?:https?:\/\/)?(?:www\.)?steamcommunity\.com\/` keeps the host a host. Unanchored, the
 *     `.com` could sit in a path (`https://evil.example/steamcommunity.com/id/admin`) or in a
 *     longer domain (`steamcommunity.com.evil.example`) and still match.
 *   - the trailing negative lookaheads stop a longer segment being truncated into a valid-looking
 *     one. Without them an 18-digit id yields the first 17 digits, which is a different, real
 *     account, and a 33-character vanity yields a different, real 32-character name.
 */
const PROFILES_URL_PATTERN = /^(?:https?:\/\/)?(?:www\.)?steamcommunity\.com\/profiles\/(\d{17})(?!\d)/;
const VANITY_URL_PATTERN =
	/^(?:https?:\/\/)?(?:www\.)?steamcommunity\.com\/id\/([A-Za-z0-9_-]{2,32})(?![A-Za-z0-9_-])/;

export type LookupTarget =
	| { kind: 'steamid64'; value: string }
	| { kind: 'vanity'; value: string }
	| { kind: 'invalid' };

export function isSteamId64(value: string): boolean {
	return STEAMID64_PATTERN.test(value);
}

/**
 * Steam's 32-bit account id (the `data-miniprofile` attribute) to a SteamID64.
 * Returns null unless the id is in range, so callers can trust a non-null result is well formed.
 * The bounds are checked numerically: '0' and '00' are the same "no account" value, and a string
 * comparison against '0' would let the padded form through as the bare base id.
 */
export function accountIdToSteamId64(accountId: string): string | null {
	if (!ACCOUNT_ID_PATTERN.test(accountId)) return null;
	const id = BigInt(accountId);
	if (id < ACCOUNT_ID_MIN || id > ACCOUNT_ID_MAX) return null;
	return (STEAMID64_BASE + id).toString();
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
