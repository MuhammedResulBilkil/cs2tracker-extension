import { describe, expect, it } from 'vitest';
import { CS2TRACKER_PROFILE_BASE, buildProfileHref, buildProfileUrl } from '../shared/cs2tracker';

describe('buildProfileUrl', () => {
	it('builds the stats URL for a SteamID64', () => {
		expect(buildProfileUrl('76561198145891996')).toBe('https://cs2tracker.gg/stats/76561198145891996');
	});

	it('uses the exported base', () => {
		expect(buildProfileUrl('1')).toBe(`${CS2TRACKER_PROFILE_BASE}1`);
	});

	it('encodes the id so it cannot escape the path', () => {
		expect(buildProfileUrl('a/../b')).toBe('https://cs2tracker.gg/stats/a%2F..%2Fb');
	});
});

describe('buildProfileHref', () => {
	it('returns a plain https URL when openExternal is false', () => {
		expect(buildProfileHref('76561198145891996', false)).toBe('https://cs2tracker.gg/stats/76561198145891996');
	});

	it('returns a steam external URL when openExternal is true', () => {
		expect(buildProfileHref('76561198145891996', true)).toBe(
			'steam://openurl_external/https://cs2tracker.gg/stats/76561198145891996',
		);
	});
});
