import { useRef, useState } from 'react';
import { DialogButton, Field, Spinner, TextField } from '@steambrew/client';
import { LOOKUP_HINT, type LookupResult } from '../services/lookup';
import { getCurrentUserProfile, openCs2TrackerProfile, resolveLookupInput } from '../services/steamid';

/**
 * Open any player's CS2Tracker page from the settings panel.
 *
 * As thin as it can be, in a specific direction: no component in this bundle can be imported by a test --
 * @steambrew/client cannot load outside the Steam client -- so every decision that could be moved out has
 * been. Which sentence a failure shows, what counts as a usable SteamID64, how long to wait for the
 * backend and whether the signed-in user's id is readable yet all live in frontend/services/lookup.ts,
 * covered by tests/frontend-lookup.test.ts.
 *
 * Two decisions do remain here, because both are about this component's own render cycle and neither can
 * be expressed anywhere else: the single-flight guard below, and when a lookup is allowed to start at all
 * (`canLookup`). Both are untestable in this repo and are named in the Task 16 verification list rather
 * than pretended away.
 *
 * Every control is a Steam component: TextField, Field, DialogButton and Spinner, with no raw input or
 * button, no className of this plugin's own and no inline style. That is a store-review requirement rather
 * than a preference, and it is a requirement about *custom* styling: what the plugin database rejects is UI
 * this plugin styles itself, not a Steam component's own declared props. Layout is therefore expressed
 * through those props -- inlineControls puts the primary button in the field's own control slot, and
 * bottomSeparator groups the rows -- and never through CSS. The one raw element is a span carrying
 * aria-live, for which Steam ships no component at all; it renders no control and carries no styling.
 *
 * The field carries no placeholder, and that is a limit of the component rather than a choice: Steam's
 * TextFieldProps extends React's HTMLAttributes rather than InputHTMLAttributes, so placeholder is not
 * among the props it declares. It would reach the input at runtime, since the component spreads what it
 * is given, but a prop that only works because the declaration is incomplete is not worth a cast --
 * LOOKUP_HINT carries the example instead, in the description slot, where it is also read aloud.
 */

interface LookupFieldProps {
	/**
	 * Passed down rather than read here, so the panel holds a single subscription to the setting and the
	 * button always opens with the value on screen at the moment it is clicked.
	 */
	openExternal: boolean;
}

export const LookupField = ({ openExternal }: LookupFieldProps) => {
	const [input, setInput] = useState('');
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	/**
	 * The same guard as `busy`, one turn of the event loop earlier. `busy` disables both buttons, but the
	 * disabled attribute only takes effect once React has re-rendered; two clicks dispatched before that
	 * commit would both read `busy === false` from their own render's closure and both start a lookup,
	 * which on the happy path means two browser tabs. A ref is read and written synchronously, so the
	 * second call returns immediately.
	 */
	const inFlight = useRef(false);

	/**
	 * One place where a result becomes something the user sees, for both buttons. It sets the message on a
	 * failure and clears it on success; the two places that clear it besides are the start of an attempt
	 * and any edit to the field, so a message is only ever on screen while it is still true.
	 */
	const apply = (result: LookupResult): void => {
		if (result.kind === 'error') {
			setError(result.message);
			return;
		}
		setError(null);
		openCs2TrackerProfile(result.steamId64, openExternal);
	};

	const lookup = async (): Promise<void> => {
		if (inFlight.current) return;
		inFlight.current = true;
		setError(null);
		setBusy(true);
		try {
			apply(await resolveLookupInput(input));
		} finally {
			// finally, not the end of the try: resolveLookupInput is documented never to reject, but a
			// throw from anywhere in here that left busy set would disable both buttons for the lifetime
			// of the panel with no way back.
			setBusy(false);
			inFlight.current = false;
		}
	};

	/**
	 * A vanity lookup is a network round trip through the backend, so the empty case is worth excluding
	 * before it starts: it is the one input that cannot succeed. One flag for both entry points, so the
	 * Enter key and the button cannot disagree about when a lookup is allowed.
	 */
	const canLookup = !busy && input.trim().length > 0;

	return (
		<>
			<TextField
				label="Look up a player"
				/*
				 * A live region, so a failure is announced rather than silently swapped into place. It has
				 * to be the wrapper and not the message, because a region announces changes to its own
				 * contents: the span is always mounted, holding the hint, and only its text changes.
				 *
				 * polite rather than assertive -- the user has just pressed a button and is waiting for
				 * exactly this, so there is nothing to interrupt.
				 *
				 * A failed lookup stays here rather than becoming a toast, and the asymmetry with a failed
				 * settings write is deliberate: a mistyped name is an ordinary outcome of using the field,
				 * and a Steam notification for ordinary user error is noise. A write that fails is a fault
				 * the user did not cause, which is why that one gets the notification.
				 */
				description={<span aria-live="polite">{error ?? LOOKUP_HINT}</span>}
				value={input}
				disabled={busy}
				bShowClearAction
				onChange={(event) => {
					setInput(event.target.value);
					// Clear on edit, not merely on the next attempt. The message occupies the description
					// slot, which is the only place the format example lives now that the field has no
					// placeholder -- so a user who clears the field to start over would otherwise be left
					// with a failure where the guidance should be.
					setError(null);
				}}
				onKeyDown={(event) => {
					// Enter is what anyone types after filling in a single-field form. Both stoppers are
					// needed for that to mean anything: preventDefault drops the implicit submit, and
					// stopPropagation keeps the key from reaching the Steam dialog wrapped around this
					// panel, which would act on it as well. Only when a lookup actually starts -- swallowing
					// the key while the field is empty would make Enter dead rather than considered.
					if (event.key !== 'Enter' || !canLookup) return;
					event.preventDefault();
					event.stopPropagation();
					void lookup();
				}}
				/*
				 * Steam's own slot for a control that belongs to the field, which is where the primary
				 * action belongs: it acts on this input, and putting it here removes the label-less Field
				 * row -- and its empty label column -- that it used to sit in.
				 */
				inlineControls={
					<DialogButton
						disabled={!canLookup}
						onClick={() => void lookup()}
						/*
						 * The name survives the spinner. While busy the button's only child is an icon, so
						 * without this it would be an unnamed button and a screen reader would announce
						 * nothing at the moment something starts. Identical to the visible label, so the
						 * two never disagree. An ARIA attribute is not styling.
						 */
						aria-label="Open on CS2Tracker"
					>
						{/*
						 * The spinner replaces the label rather than joining it, which keeps the button one
						 * child wide in both states. Sized by SVG width and height attributes -- the
						 * asset's own dimensions, not CSS applied to a Steam component -- because this icon
						 * has no intrinsic size and would otherwise stretch to whatever the button gives it.
						 */}
						{busy ? <Spinner width={16} height={16} /> : 'Open on CS2Tracker'}
					</DialogButton>
				}
			/>
			<Field
				label="Your own stats"
				description="Opens the CS2Tracker page for the account signed in to Steam."
				bottomSeparator="standard"
				focusable={false}
			>
				{/*
				 * Its own row and its own button, never a fallback for the field above. An empty or
				 * unparseable lookup answers with a message; if it quietly opened the signed-in user's
				 * stats instead, the panel would look like it had worked and the user would be reading
				 * somebody else's numbers as though they were the player they asked for.
				 */}
				<DialogButton disabled={busy} onClick={() => apply(getCurrentUserProfile())}>
					My profile
				</DialogButton>
			</Field>
		</>
	);
};
