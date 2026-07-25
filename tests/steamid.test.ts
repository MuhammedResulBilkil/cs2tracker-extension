import { describe, expect, it } from 'vitest';
import { accountIdToSteamId64, isSteamId64, parseLookupInput } from '../shared/steamid';

describe('isSteamId64', () => {
	it('accepts a real SteamID64', () => {
		expect(isSteamId64('76561198145891996')).toBe(true);
	});

	it('rejects a 17-digit number below the Steam range', () => {
		expect(isSteamId64('12345678901234567')).toBe(false);
	});

	it('rejects short and non-numeric input', () => {
		expect(isSteamId64('7656119814589')).toBe(false);
		expect(isSteamId64('76561198145891996x')).toBe(false);
		expect(isSteamId64('')).toBe(false);
	});

	// The valid interval is STEAMID64_BASE + 1 through STEAMID64_BASE + 4294967295. Pinned here as
	// literals so the bounds the implementation derives cannot drift without a test noticing.
	it('accepts the exact lower bound and rejects the base beneath it', () => {
		expect(isSteamId64('76561197960265729')).toBe(true);
		expect(isSteamId64('76561197960265728')).toBe(false);
	});

	it('accepts the exact upper bound and rejects one past it', () => {
		expect(isSteamId64('76561202255233023')).toBe(true);
		expect(isSteamId64('76561202255233024')).toBe(false);
	});

	// A digit-prefix check accepts anything starting 7656119, which includes ids beneath the base.
	it('rejects a below-base value that a 7656119 prefix check would accept', () => {
		expect(isSteamId64('76561190000000000')).toBe(false);
	});

	// BigInt(' 123 ') and BigInt('+123') both parse, so the shape test has to run first or padded
	// input would validate. BigInt('123x') throws, so that test also keeps this function total.
	it('rejects padded and signed forms instead of parsing them', () => {
		expect(isSteamId64(' 76561198145891996 ')).toBe(false);
		expect(isSteamId64('+76561198145891996')).toBe(false);
	});
});

describe('accountIdToSteamId64', () => {
	it('converts an account id to a SteamID64', () => {
		expect(accountIdToSteamId64('185626268')).toBe('76561198145891996');
	});

	it('rejects zero and non-numeric input', () => {
		expect(accountIdToSteamId64('0')).toBeNull();
		expect(accountIdToSteamId64('abc')).toBeNull();
		expect(accountIdToSteamId64('')).toBeNull();
	});

	// '00' is numerically the "no account" value, so it must be rejected like '0'. Returning the
	// bare base id here would hand callers 76561197960265728 dressed up as a real profile.
	it('rejects zero written with padding', () => {
		expect(accountIdToSteamId64('00')).toBeNull();
		expect(accountIdToSteamId64('0000000000')).toBeNull();
	});

	it('accepts the largest unsigned 32-bit account id', () => {
		expect(accountIdToSteamId64('4294967295')).toBe('76561202255233023');
	});

	it('rejects account ids above the unsigned 32-bit range', () => {
		expect(accountIdToSteamId64('4294967296')).toBeNull();
		expect(accountIdToSteamId64('99999999999999999999')).toBeNull();
	});

	// The consumer pattern in Tasks 5-8: convert a data-miniprofile id, then validate the result.
	// 2039734272 is the account id where the old 7656119 digit prefix rolled over to 7656120 and
	// started rejecting ids Steam legitimately emits.
	it.each(['1', '185626268', '2039734272', '4294967295'])(
		'converts account id %s into a value isSteamId64 accepts',
		(accountId) => {
			const steamId64 = accountIdToSteamId64(accountId);
			expect(steamId64).not.toBeNull();
			expect(isSteamId64(String(steamId64))).toBe(true);
		},
	);
});

describe('parseLookupInput', () => {
	it('accepts a bare SteamID64', () => {
		expect(parseLookupInput('76561198145891996')).toEqual({ kind: 'steamid64', value: '76561198145891996' });
	});

	it('trims surrounding whitespace', () => {
		expect(parseLookupInput('  76561198145891996  ')).toEqual({ kind: 'steamid64', value: '76561198145891996' });
	});

	it('extracts the id from a /profiles/ URL', () => {
		expect(parseLookupInput('https://steamcommunity.com/profiles/76561198145891996/')).toEqual({
			kind: 'steamid64',
			value: '76561198145891996',
		});
	});

	it('extracts the vanity from an /id/ URL', () => {
		expect(parseLookupInput('https://steamcommunity.com/id/intkira/')).toEqual({ kind: 'vanity', value: 'intkira' });
	});

	it('treats a bare name as a vanity', () => {
		expect(parseLookupInput('intkira')).toEqual({ kind: 'vanity', value: 'intkira' });
	});

	it('accepts a scheme-less and a www URL', () => {
		expect(parseLookupInput('steamcommunity.com/profiles/76561198145891996')).toEqual({
			kind: 'steamid64',
			value: '76561198145891996',
		});
		expect(parseLookupInput('https://www.steamcommunity.com/id/intkira')).toEqual({ kind: 'vanity', value: 'intkira' });
	});

	// One extra digit must not be silently truncated to a valid-looking id: that would send the
	// user to a stranger's stats page with no error shown.
	it('rejects a /profiles/ URL carrying more than 17 digits', () => {
		expect(parseLookupInput('https://steamcommunity.com/profiles/765611981458919961')).toEqual({ kind: 'invalid' });
	});

	it('rejects a /profiles/ URL whose id is outside the Steam range', () => {
		expect(parseLookupInput('https://steamcommunity.com/profiles/12345678901234567')).toEqual({ kind: 'invalid' });
	});

	// The bare 33-character name is rejected below, so the URL form has to agree with it.
	it('rejects an over-long vanity in an /id/ URL', () => {
		expect(parseLookupInput(`https://steamcommunity.com/id/${'x'.repeat(33)}`)).toEqual({ kind: 'invalid' });
	});

	it('requires steamcommunity.com to be the host rather than any path segment', () => {
		expect(parseLookupInput('https://evil.example/steamcommunity.com/id/admin')).toEqual({ kind: 'invalid' });
		expect(parseLookupInput('https://evil.example/steamcommunity.com/profiles/76561198145891996')).toEqual({
			kind: 'invalid',
		});
		expect(parseLookupInput('https://steamcommunity.com.evil.example/id/admin')).toEqual({ kind: 'invalid' });
	});

	/**
	 * This function's input is the URL of the page webkit is running on, and a hostname is case-insensitive
	 * by definition -- so a URL that arrives as `SteamCommunity.com` is the same URL. Without the `i` flag on
	 * both patterns it fell through to the bare-vanity test, failed that too on the `/` and `:` characters,
	 * and came back invalid -- which in webkit means an unrecognised profile root and no button on a page
	 * that should have had one.
	 *
	 * The scheme and the path segment are folded by the same flag, so they are pinned here as well. What is
	 * deliberately *not* folded is the captured text, which the last case checks.
	 */
	it('accepts a URL whose host, scheme, or path segment is mixed-case', () => {
		expect(parseLookupInput('https://SteamCommunity.com/id/foo/')).toEqual({ kind: 'vanity', value: 'foo' });
		expect(parseLookupInput('https://SteamCommunity.com/profiles/76561198145891996')).toEqual({
			kind: 'steamid64',
			value: '76561198145891996',
		});
		expect(parseLookupInput('HTTPS://WWW.STEAMCOMMUNITY.COM/ID/foo')).toEqual({ kind: 'vanity', value: 'foo' });
		expect(parseLookupInput('SteamCommunity.com/Profiles/76561198145891996')).toEqual({
			kind: 'steamid64',
			value: '76561198145891996',
		});
		expect(parseLookupInput('https://steamcommunity.com/id/IntKira')).toEqual({ kind: 'vanity', value: 'IntKira' });
	});

	// Folding case must not fold the host boundary: `i` is about spelling, and every lookalike rejected above
	// stays rejected in any capitalisation.
	it('still rejects lookalike hosts in mixed case', () => {
		expect(parseLookupInput('https://EVIL.example/SteamCommunity.com/id/admin')).toEqual({ kind: 'invalid' });
		expect(parseLookupInput('https://SteamCommunity.com.evil.example/id/admin')).toEqual({ kind: 'invalid' });
		expect(parseLookupInput('https://Evil-SteamCommunity.com/id/admin')).toEqual({ kind: 'invalid' });
	});

	it('rejects empty input and anything with unsafe characters', () => {
		expect(parseLookupInput('')).toEqual({ kind: 'invalid' });
		expect(parseLookupInput('   ')).toEqual({ kind: 'invalid' });
		expect(parseLookupInput('a b')).toEqual({ kind: 'invalid' });
		expect(parseLookupInput('../../etc/passwd')).toEqual({ kind: 'invalid' });
		expect(parseLookupInput('x'.repeat(33))).toEqual({ kind: 'invalid' });
	});
});
