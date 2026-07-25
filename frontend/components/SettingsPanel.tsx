import { Field, Toggle } from '@steambrew/client';
import type { PluginSettings } from '../../shared/settings';
import { SETTING_LABELS } from '../services/setting-value';
import { useSettings } from '../services/settings';

/**
 * The panel under Millennium -> Plugins, and the only part of this plugin the user meets inside Steam's
 * own UI rather than on a web page.
 *
 * Three toggles, and nothing else. Both of Steam's components: Field for each row, Toggle for the control
 * inside it. No raw input or button, no stylesheet, no inline style, no DOM of this plugin's own. The
 * plugin database rejects custom-styled settings UI, so that is a requirement and not a preference -- and
 * it is also why the ordering below is the whole of the layout.
 *
 * It also held a lookup field and a "My profile" button, which have been removed along with everything
 * only they reached: the vanity-name RPC in the backend, the two frontend service modules behind them, and
 * the plugin's one outbound HTTP request. What is left injects links into pages the user is already
 * looking at, so the panel is settings and nothing more.
 *
 * All three toggles come from one useSettings call, which reads the settings once from the Lua backend
 * and writes them back one key at a time. Not from Millennium's config API: reads through it never
 * arrived, leaving this panel showing the shipped defaults over whatever the config file actually held,
 * so every click was computed against a value that was not the stored one. frontend/services/settings.ts
 * records the mechanism.
 */

/**
 * Every one of these settings is read once, when a page loads: the webkit bundle asks for them as it
 * starts and does not watch for changes. So a toggle flipped now applies to the next profile page, not to
 * the ones already open, and saying so is the difference between a working plugin and one that looks
 * broken for as long as the user leaves a stale tab in front of them.
 */
const REOPEN_HINT = 'Reopen any pages you already have open to apply this change.';

/**
 * Each toggle's description, named rather than inlined so the JSX below stays a readable list of rows.
 * They belong here and not beside the labels in setting-value.ts: nothing else has to agree with this
 * prose, and it is only meaningful next to the control it describes.
 *
 * Typed as a total Record for the reason SETTING_LABELS is, and it was `as const` until that reason was
 * noticed to apply here too: a fourth key added to PluginSettings has to be a compile error somewhere in
 * this file. It has a backend default, a drift test that keeps the two default tables in step, and a
 * label -- so none of the existing gates would say a word about a setting that reached the panel with no
 * prose, and the toggle would render with an empty description. The annotation puts the error in the one
 * file whose JSX also has to grow a row, which is where the author needs to be standing.
 *
 * That is the guard's actual reach, and it stops short of a guarantee: the list of Field rows below is
 * written out by hand, so nothing here *forces* the new row to be added, only the description it would
 * use. Rendering the list from these keys instead would close that, at the cost of making the element
 * order -- which is the whole of this panel's layout, and a store-review requirement -- implicit in an
 * object literal rather than visible in the JSX. Left explicit deliberately.
 */
const DESCRIPTIONS: Readonly<Record<keyof PluginSettings, string>> = Object.freeze({
	showOnProfiles: `Adds a CS2Tracker button to Steam community profiles. ${REOPEN_HINT}`,
	showOnFriendLists:
		`Adds a CS2Tracker link to each row of your friends and recently-played-with lists. ${REOPEN_HINT}`,
	openExternal:
		"Opens CS2Tracker in your system browser instead of Steam's built-in one. Useful if the built-in " +
		`browser is stopped by the site's bot protection. ${REOPEN_HINT}`,
});

export const SettingsPanel = () => {
	const { settings, setSetting, loaded } = useSettings();

	return (
		<>
			{/*
			 * Field + Toggle, not ToggleField.
			 *
			 * Two reasons, and the first is the one that matters. ToggleField renders as a two-option
			 * OFF/ON segmented control, and the selected option is distinguished only by a class Steam adds
			 * -- which a theme is free to restyle. Under one Material theme the result was unreadable: its
			 * recolor rules pair `.DialogToggleField_Option.On` with `.Off.Active` and `.Off` with
			 * `.On.Active`, which only makes sense alongside a second rule that hides the inactive option --
			 * and that rule ships in the theme's *web* stylesheet, so it never loads in the client UI. Both
			 * options therefore render in the same colour and the control shows no state at all.
			 *
			 * Toggle renders Steam's switch instead. It carries aria-checked, so its state lives in the
			 * accessibility tree rather than in a class name a theme might repaint, and knob position
			 * communicates on/off even with every one of the theme's rules stripped. It is also far narrower
			 * than a segmented pair, which is what lets the label and control share a row in a ~330px
			 * sidebar without the crowding that made the segmented version look broken.
			 *
			 * Second reason: this is the composition the plugin database's review guidance actually names --
			 * Field for the row, Toggle for the control inside it. ToggleField is not on that list.
			 *
			 * Note the prop is `value`, not `checked`. Same boolean, different name from ToggleField's.
			 *
			 * Every switch is disabled until the first read has answered. Steam's Toggle reports
			 * `onChange(!value)`, so a click landing before then is computed against the shipped default
			 * rather than the stored value -- which, on an account where the two differ, writes the value
			 * the user believed they were changing away from.
			 */}
			<Field
				label={SETTING_LABELS.showOnProfiles}
				description={DESCRIPTIONS.showOnProfiles}
				bottomSeparator="standard"
			>
				<Toggle
					value={settings.showOnProfiles}
					disabled={!loaded}
					onChange={(value) => setSetting('showOnProfiles', value)}
				/>
			</Field>
			<Field
				label={SETTING_LABELS.showOnFriendLists}
				description={DESCRIPTIONS.showOnFriendLists}
				bottomSeparator="standard"
			>
				<Toggle
					value={settings.showOnFriendLists}
					disabled={!loaded}
					onChange={(value) => setSetting('showOnFriendLists', value)}
				/>
			</Field>
			<Field
				label={SETTING_LABELS.openExternal}
				description={DESCRIPTIONS.openExternal}
				bottomSeparator="standard"
			>
				<Toggle
					value={settings.openExternal}
					disabled={!loaded}
					onChange={(value) => setSetting('openExternal', value)}
				/>
			</Field>
		</>
	);
};
