import { useRef, useState } from 'react';
import { DialogButton, Field, Spinner, TextField } from '@steambrew/client';
import { LOOKUP_HINT, type LookupResult } from '../services/lookup';
import { getCurrentUserProfile, openCs2TrackerProfile, resolveLookupInput } from '../services/steamid';

/**
 * Open any player's CS2Tracker page from the settings panel.
 *
 * Deliberately thin, and thin in a specific direction: no component in this bundle can be imported by a
 * test -- @steambrew/client cannot load outside the Steam client -- so everything here that could be a
 * decision has been moved into frontend/services/lookup.ts instead. Which sentence a failure shows, what
 * counts as a usable SteamID64, and whether the signed-in user's id is readable yet are all decided
 * there and covered by tests/frontend-lookup.test.ts. What is left is three pieces of local state and a
 * tree of Steam's own components.
 *
 * Every control is a Steam component: TextField, Field, DialogButton and Spinner, with no raw input or
 * button, no className of this plugin's own and no inline style. That is a store-review requirement
 * rather than a preference -- the plugin database rejects custom-styled settings UI -- and it is also why
 * the layout is expressed as Steam field rows and their separators instead of a flex container.
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
	 * One place where a result becomes something the user sees, for both buttons. The error is cleared
	 * only on success, so a stale message cannot outlive the failure that produced it while still being
	 * replaced by the next one.
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
				description={error ?? LOOKUP_HINT}
				value={input}
				disabled={busy}
				bShowClearAction
				onChange={(event) => setInput(event.target.value)}
				onKeyDown={(event) => {
					// Enter is what anyone types after filling in a single-field form, and without this it
					// would submit Steam's surrounding dialog instead of running the lookup.
					if (event.key === 'Enter' && canLookup) void lookup();
				}}
			/>
			<Field bottomSeparator="none" focusable={false}>
				<DialogButton disabled={!canLookup} onClick={() => void lookup()}>
					{/*
					 * The spinner replaces the label rather than joining it: two children in one button
					 * would need a gap between them, and a gap is layout this plugin is not allowed to
					 * style. Sized by SVG width and height attributes, which are the asset's own
					 * dimensions rather than CSS applied to a Steam component -- without them the icon
					 * has no intrinsic size and stretches to whatever the button gives it.
					 */}
					{busy ? <Spinner width={16} height={16} /> : 'Open on CS2Tracker'}
				</DialogButton>
			</Field>
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
