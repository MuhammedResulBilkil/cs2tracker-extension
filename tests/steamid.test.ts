import { describe, expect, it } from 'vitest';
import { accountIdToSteamId64, isSteamId64, parseLookupInput } from '../shared/steamid';

describe('isSteamId64', () => {
	it('accepts a real SteamID64', () => {
		expect(isSteamId64('76561198145891996')).toBe(true);
	});

	it('rejects a 17-digit number outside the Steam range', () => {
		expect(isSteamId64('12345678901234567')).toBe(false);
	});

	it('rejects short and non-numeric input', () => {
		expect(isSteamId64('7656119814589')).toBe(false);
		expect(isSteamId64('76561198145891996x')).toBe(false);
		expect(isSteamId64('')).toBe(false);
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

	it('rejects empty input and anything with unsafe characters', () => {
		expect(parseLookupInput('')).toEqual({ kind: 'invalid' });
		expect(parseLookupInput('   ')).toEqual({ kind: 'invalid' });
		expect(parseLookupInput('a b')).toEqual({ kind: 'invalid' });
		expect(parseLookupInput('../../etc/passwd')).toEqual({ kind: 'invalid' });
		expect(parseLookupInput('x'.repeat(33))).toEqual({ kind: 'invalid' });
	});
});
