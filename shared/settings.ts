export interface PluginSettings {
	openExternal: boolean;
	showOnProfiles: boolean;
	showOnFriendLists: boolean;
}

export const DEFAULT_SETTINGS: Readonly<PluginSettings> = Object.freeze({
	openExternal: false,
	showOnProfiles: true,
	showOnFriendLists: true,
});

const SETTING_KEYS = Object.keys(DEFAULT_SETTINGS) as Array<keyof PluginSettings>;

/** Coerce anything the backend hands us into a complete, well-typed settings object. */
export function normalizeSettings(raw: unknown): PluginSettings {
	const result = { ...DEFAULT_SETTINGS };
	if (!raw || typeof raw !== 'object') return result;

	const source = raw as Record<string, unknown>;
	for (const key of SETTING_KEYS) {
		if (typeof source[key] === 'boolean') result[key] = source[key] as boolean;
	}
	return result;
}
