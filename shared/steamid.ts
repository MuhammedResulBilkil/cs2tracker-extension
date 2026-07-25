const STEAMID64_BASE = BigInt('76561197960265728');
const VANITY_PATTERN = /^[A-Za-z0-9_-]{2,32}$/;

/** Steam account ids are unsigned 32-bit, so 1..4294967295 is the whole legal range. */
const ACCOUNT_ID_PATTERN = /^\d{1,10}$/;
const ACCOUNT_ID_MIN = BigInt(1);
const ACCOUNT_ID_MAX = BigInt('4294967295');

/*
 * An individual SteamID64 is exactly STEAMID64_BASE plus a legal account id, so the valid interval
 * is 76561197960265729..76561202255233023 inclusive. The bounds are derived from the account id
 * range above rather than written out, so the two functions here cannot disagree about it.
 *
 * A digit-prefix test cannot express that interval. `^7656119\d{10}$` was wrong at both ends: it
 * accepted everything from 76561190000000000 up, which is below the base and so not an account at
 * all, and it rejected every id from account 2039734272 onward, where the prefix rolls over to
 * 7656120. Task 8 validates `data-steamid` values that Steam itself produced, so the second half
 * would have silently dropped friend badges as account ids grew past that point.
 *
 * Comparison is BigInt, not Number: 76561202255233023 and 76561202255233024 both round to the same
 * double, so a Number check literally cannot tell the upper bound from one past it.
 */
const STEAMID64_SHAPE = /^\d{17}$/;
const STEAMID64_MIN = STEAMID64_BASE + ACCOUNT_ID_MIN;
const STEAMID64_MAX = STEAMID64_BASE + ACCOUNT_ID_MAX;

/*
 * Both URL patterns are anchored at both ends of the interesting segment:
 *   - `^(?:https?:\/\/)?(?:www\.)?steamcommunity\.com\/` keeps the host a host. Unanchored, the
 *     `.com` could sit in a path (`https://evil.example/steamcommunity.com/id/admin`) or in a
 *     longer domain (`steamcommunity.com.evil.example`) and still match.
 *   - the trailing negative lookaheads stop a longer segment being truncated into a valid-looking
 *     one. Without them an 18-digit id yields the first 17 digits, which is a different, real
 *     account, and a 33-character vanity yields a different, real 32-character name.
 *
 * Both carry `i`, and it is the one thing here that is about the user rather than about safety. A
 * hostname is case-insensitive by definition, and a URL copied out of a browser's address bar or
 * typed by hand arrives as `HTTPS://SteamCommunity.com/id/foo` as readily as in lower case -- so
 * without the flag the lookup box answers "not a valid profile" to a profile URL that is perfectly
 * valid, which is the plugin telling the user they are wrong about something they are right about.
 *
 * It widens nothing that matters. Both capture groups and both lookaheads already span `A-Za-z`, so
 * `i` cannot admit a character they would have rejected; `\d{17}` has no case to fold. It leaves the
 * captured text exactly as written, too, so a mixed-case vanity reaches ResolveVanity as the user
 * typed it -- which is what Steam's own vanity resolution expects, being case-insensitive itself.
 */
const PROFILES_URL_PATTERN = /^(?:https?:\/\/)?(?:www\.)?steamcommunity\.com\/profiles\/(\d{17})(?!\d)/i;
const VANITY_URL_PATTERN =
	/^(?:https?:\/\/)?(?:www\.)?steamcommunity\.com\/id\/([A-Za-z0-9_-]{2,32})(?![A-Za-z0-9_-])/i;

export type LookupTarget =
	| { kind: 'steamid64'; value: string }
	| { kind: 'vanity'; value: string }
	| { kind: 'invalid' };

/**
 * True only for a SteamID64 in the individual-account range.
 * The shape test runs first so the function stays total: `BigInt` throws on a non-numeric string,
 * and it silently accepts padding and a leading `+`, either of which would otherwise validate.
 */
export function isSteamId64(value: string): boolean {
	if (!STEAMID64_SHAPE.test(value)) return false;
	const id = BigInt(value);
	return id >= STEAMID64_MIN && id <= STEAMID64_MAX;
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
