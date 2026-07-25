import { Field, Toggle } from '@steambrew/client';
import type { PluginSettings } from '../../shared/settings';
import { SETTING_LABELS } from '../services/setting-value';
import { useSetting } from '../services/settings';
import { LookupField } from './LookupField';

/**
 * The panel under Millennium -> Plugins, and the only part of this plugin the user meets inside Steam's
 * own UI rather than on a web page.
 *
 * Three toggles and a lookup field, all of them Steam's components: Field and Toggle here, and TextField,
 * Field, DialogButton and Spinner in LookupField. No raw input or button, no stylesheet, no inline style,
 * no DOM of this plugin's own. The plugin database rejects custom-styled settings UI, so that is a
 * requirement and not a preference -- and it is also why the ordering below is the whole of the layout.
 *
 * Each toggle is bound with useSetting, which reads and writes Millennium's config store reactively. The
 * setter is handed straight to onChange: it is recreated on every render by design, and since nothing
 * here is memoised there is no dependency for a useCallback to stabilise.
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
	const [openExternal, setOpenExternal] = useSetting('openExternal');
	const [showOnProfiles, setShowOnProfiles] = useSetting('showOnProfiles');
	const [showOnFriendLists, setShowOnFriendLists] = useSetting('showOnFriendLists');

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
			 */}
			<Field
				label={SETTING_LABELS.showOnProfiles}
				description={DESCRIPTIONS.showOnProfiles}
				bottomSeparator="standard"
			>
				<Toggle value={showOnProfiles} onChange={setShowOnProfiles} />
			</Field>
			<Field
				label={SETTING_LABELS.showOnFriendLists}
				description={DESCRIPTIONS.showOnFriendLists}
				bottomSeparator="standard"
			>
				<Toggle value={showOnFriendLists} onChange={setShowOnFriendLists} />
			</Field>
			<Field
				label={SETTING_LABELS.openExternal}
				description={DESCRIPTIONS.openExternal}
				bottomSeparator="standard"
			>
				<Toggle value={openExternal} onChange={setOpenExternal} />
			</Field>
			{/*
			 * openExternal is passed down rather than read again inside LookupField, so the panel holds one
			 * subscription to the setting and the toggle above cannot disagree with the button below about
			 * which browser to open.
			 */}
			<LookupField openExternal={openExternal} />
		</>
	);
};
