import { type PluginSettings } from '../../shared/settings';

/**
 * Every word the settings panel needs, in a module that imports nothing from Steam.
 *
 * Its own file for the reason webkit/teardown.ts is its own file: the only thing that would make any
 * of this unreachable by a test is sharing a module with the one import that requires the Steam
 * client. @steambrew/client cannot be loaded outside it -- see frontend/services/settings.ts for
 * why -- so anything left in that file is untestable by construction, and everything below is
 * exactly the part that did not have to be.
 *
 * It held two more functions until the panel stopped going through Millennium's config API.
 * `resolveSetting` chose between a stored value and a default one key at a time, which the hook no
 * longer does: it now holds a whole PluginSettings object decoded in one step by parseSettings.
 * `guardSettingWrite` wrapped an untrusted async write so that a rejection, a synchronous throw, or
 * a non-promise return could not escape into a React event handler -- all three of which a plain
 * `try { await ... }` handles on its own, which is what the hook does now. Both were deleted rather
 * than left exported: an unused wrapper is the next person's answer to a problem it no longer solves.
 */

/**
 * The name each setting goes by on screen, in one place because two surfaces show it: the toggle the
 * user clicks and the toast that appears when saving it fails. Written here rather than inline in the
 * panel so that the toast cannot name a setting differently from the toggle it belongs to, and so that
 * the words are covered by a test -- the panel is not.
 *
 * Labels only. Each toggle's longer description stays in the panel, where it is prose next to the
 * control it describes and nothing else needs to agree with it.
 *
 * Typed as a total Record, so a fourth setting key is a compile error here rather than an undefined
 * label in a toast.
 */
export const SETTING_LABELS: Readonly<Record<keyof PluginSettings, string>> = Object.freeze({
	openExternal: 'Open in external browser',
	showOnProfiles: 'Show on profile pages',
	showOnFriendLists: 'Show on friend lists',
});

/**
 * What to tell the user when a setting could not be saved.
 *
 * The panel moves the switch as soon as it is clicked and rolls it back if the write fails, so from the
 * user's side a failure looks exactly like a click that never registered. The only other trace is a
 * console line they will never open. Two sentences in Steam's own notification surface are the smallest
 * thing that closes that gap, and naming the setting matters because by the time the write fails the
 * user may have flipped another one.
 *
 * Returns the words and not a toast, so this module stays free of Steam: frontend/services/settings.ts
 * spreads it into toaster.toast(). The shape is deliberately a subset of Steam's ToastData -- title and
 * body are the only two of its fields that are required -- so structural typing does the rest without a
 * type import from a package a test cannot load.
 */
export function settingWriteFailureNotice(key: keyof PluginSettings): { title: string; body: string } {
	return {
		title: 'CS2Tracker Extension',
		body: `Could not save "${SETTING_LABELS[key]}". The setting was left unchanged.`,
	};
}
