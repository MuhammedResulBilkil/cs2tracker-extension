import { ToggleField } from '@steambrew/client';
import { SETTING_LABELS } from '../services/setting-value';
import { useSetting } from '../services/settings';
import { LookupField } from './LookupField';

/**
 * The panel under Millennium -> Plugins, and the only part of this plugin the user meets inside Steam's
 * own UI rather than on a web page.
 *
 * Three toggles and a lookup field, all of them Steam's components: ToggleField here, and TextField,
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
 */
const DESCRIPTIONS = {
	showOnProfiles: `Adds a CS2Tracker button to Steam community profiles. ${REOPEN_HINT}`,
	showOnFriendLists:
		`Adds a CS2Tracker link to each row of your friends and recently-played-with lists. ${REOPEN_HINT}`,
	openExternal:
		"Opens CS2Tracker in your system browser instead of Steam's built-in one. Useful if the built-in " +
		`browser is stopped by the site's bot protection. ${REOPEN_HINT}`,
} as const;

export const SettingsPanel = () => {
	const [openExternal, setOpenExternal] = useSetting('openExternal');
	const [showOnProfiles, setShowOnProfiles] = useSetting('showOnProfiles');
	const [showOnFriendLists, setShowOnFriendLists] = useSetting('showOnFriendLists');

	return (
		<>
			<ToggleField
				label={SETTING_LABELS.showOnProfiles}
				description={DESCRIPTIONS.showOnProfiles}
				checked={showOnProfiles}
				onChange={setShowOnProfiles}
			/>
			<ToggleField
				label={SETTING_LABELS.showOnFriendLists}
				description={DESCRIPTIONS.showOnFriendLists}
				checked={showOnFriendLists}
				onChange={setShowOnFriendLists}
			/>
			<ToggleField
				label={SETTING_LABELS.openExternal}
				description={DESCRIPTIONS.openExternal}
				checked={openExternal}
				onChange={setOpenExternal}
			/>
			{/*
			 * openExternal is passed down rather than read again inside LookupField, so the panel holds one
			 * subscription to the setting and the toggle above cannot disagree with the button below about
			 * which browser to open.
			 */}
			<LookupField openExternal={openExternal} />
		</>
	);
};
