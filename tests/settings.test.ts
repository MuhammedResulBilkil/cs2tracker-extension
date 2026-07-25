import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, normalizeSettings } from '../shared/settings';

describe('normalizeSettings', () => {
	it('returns the defaults for null, undefined, and non-objects', () => {
		expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS);
		expect(normalizeSettings(undefined)).toEqual(DEFAULT_SETTINGS);
		expect(normalizeSettings('nope')).toEqual(DEFAULT_SETTINGS);
		expect(normalizeSettings(42)).toEqual(DEFAULT_SETTINGS);
	});

	it('keeps valid boolean values', () => {
		expect(normalizeSettings({ openExternal: true, showOnProfiles: false, showOnFriendLists: false })).toEqual({
			openExternal: true,
			showOnProfiles: false,
			showOnFriendLists: false,
		});
	});

	it('falls back per key when a value has the wrong type', () => {
		expect(normalizeSettings({ openExternal: 'yes', showOnProfiles: false })).toEqual({
			openExternal: false,
			showOnProfiles: false,
			showOnFriendLists: true,
		});
	});

	it('ignores unknown keys', () => {
		expect(normalizeSettings({ nope: 1 })).toEqual(DEFAULT_SETTINGS);
	});

	it('returns a fresh object each time', () => {
		const first = normalizeSettings(null);
		first.openExternal = true;
		expect(normalizeSettings(null).openExternal).toBe(false);
	});
});
