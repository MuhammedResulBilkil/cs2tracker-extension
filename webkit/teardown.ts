import { removeFriendBadges } from './inject-friendblocks';
import { removeProfileButton } from './inject-profile';
import { disposeAll } from './lifecycle';
import { removeStyles } from './styles';

/**
 * Undo everything this bundle did to a document, and stop everything it started.
 *
 * Its own module, and that is about testability rather than tidiness. This function needs nothing from Steam
 * -- four imported removers and a Document -- so the only thing that ever made it unreachable was sharing a
 * file with the entry's @steambrew/webkit import. It is also the function the store review cares most about,
 * and neither of the two mistakes it can make fails loudly: swap the disposal past the removals, or drop the
 * last line, and the plugin still works perfectly on every page it was switched on for.
 *
 * disposeAll comes first because disposal unwinds construction. Today the removals are removal-only, and
 * webkit/inject-friendblocks.ts skips a batch with no added nodes, so a still-connected friend-block observer
 * would not in fact re-badge behind them -- and MutationObserver callbacks are asynchronous, so nothing can
 * run in the middle of a synchronous teardown anyway. The order is still the invariant rather than a
 * preference: it holds without depending on either of those two facts, both of which live in other modules
 * and neither of which this function can see.
 *
 * removeStyles comes last, and it is the reason this function exists at all rather than the entry just
 * handing disposeAll to a listener. Neither remover above touches the stylesheet -- webkit/inject-profile.ts
 * declines because the badges may still need it, webkit/inject-friendblocks.ts declines because the button
 * may -- so after both is the only correct place, and the obligation is recorded at
 * webkit/inject-friendblocks.ts:204. It is not an aesthetic loose end either: styles.ts records that
 * `.friend_block_v2{position:relative}` makes every friend row the containing block for Steam's own
 * absolutely positioned row descendants, so a page left carrying the sheet after teardown is carrying a
 * change to Steam's layout with nothing left to justify it.
 *
 * Takes the document rather than reading the global, for the reason every injector in this bundle does: the
 * community browser opens a separate document per page, and a remover that can only reach one of them is a
 * remover that silently misses the rest.
 */
export function teardown(doc: Document): void {
	disposeAll();
	removeProfileButton(doc);
	removeFriendBadges(doc);
	removeStyles(doc);
}
