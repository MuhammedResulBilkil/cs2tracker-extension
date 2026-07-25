import { describe, expect, it } from 'vitest';
import { SETTING_LABELS, settingWriteFailureNotice } from '../frontend/services/setting-value';
import { DEFAULT_SETTINGS, type PluginSettings } from '../shared/settings';

/** Every setting key, taken from the defaults so a fourth key cannot be added without reaching these cases. */
const KEYS = Object.keys(DEFAULT_SETTINGS) as Array<keyof PluginSettings>;

describe('SETTING_LABELS', () => {
	// The panel's toggle labels and the failed-write toast read from the same map, so a setting cannot be
	// called one thing where it is switched and another where its failure is reported.
	it('gives every setting its own non-empty name', () => {
		const labels = KEYS.map((key) => SETTING_LABELS[key]);

		expect(labels.every((label) => label.trim().length > 0)).toBe(true);
		expect(new Set(labels).size).toBe(labels.length);
	});

	/**
	 * Pinned per key. The map is the only place these words exist, so two of them trading places would
	 * relabel two toggles and misname the setting in the toast, with nothing else in the suite noticing.
	 */
	it('names each key with the words its own toggle shows', () => {
		expect(SETTING_LABELS.showOnProfiles).toBe('Show on profile pages');
		expect(SETTING_LABELS.showOnFriendLists).toBe('Show on friend lists');
		expect(SETTING_LABELS.openExternal).toBe('Open in external browser');
	});
});

describe('settingWriteFailureNotice', () => {
	/**
	 * The toast is the only thing that tells a user why a toggle they just clicked snapped back: the panel
	 * moves the switch on click and rolls it back when the write fails, so a failure is otherwise
	 * indistinguishable from not having clicked at all.
	 */
	it('names the plugin, so the toast is attributable', () => {
		for (const key of KEYS) {
			expect(settingWriteFailureNotice(key).title).toMatch(/cs2tracker/i);
		}
	});

	// Three toggles, and by the time the toast arrives the user may have flipped more than one of them.
	it('names the setting that failed, in the words its toggle uses', () => {
		for (const key of KEYS) {
			expect(settingWriteFailureNotice(key).body).toContain(SETTING_LABELS[key]);
		}

		const bodies = KEYS.map((key) => settingWriteFailureNotice(key).body);
		expect(new Set(bodies).size).toBe(bodies.length);
	});

	// What the user can see -- the toggle back where it was -- said out loud, because a toast that only
	// reported a failure would leave them guessing whether the change had half-applied.
	it('says the setting was left unchanged', () => {
		expect(settingWriteFailureNotice('openExternal').body).toMatch(/left unchanged/i);
	});
});
