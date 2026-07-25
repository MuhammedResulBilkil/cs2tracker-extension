import { type JSX } from 'react';
import { definePlugin, type Plugin } from '@steambrew/client';
import { CS2TrackerIcon } from './assets/Icon';
import { SettingsPanel } from './components/SettingsPanel';

/**
 * The frontend entry point: the one function Millennium calls in the Steam client's UI process.
 *
 * Its return value is not a component but a registration. Millennium's build wraps this module in a
 * loader that awaits the default export and then, only if title, icon and content are all present,
 * assigns the result to window.MILLENNIUM_SIDEBAR_NAVIGATION_PANELS[pluginName]. A missing one of the
 * three is not an error anywhere: the panel simply never appears in the sidebar.
 */

/**
 * The shape Millennium's loader actually requires, which is not the one @steambrew/client publishes.
 *
 * `Plugin` declares version, icon, content, onDismount, alwaysRender and titleView -- and not title,
 * although the official template and both reference plugins pass it. The loader settles it: the
 * generated wrapper in @steambrew/ttc guards on `pluginProps.title !== undefined && pluginProps.icon
 * !== undefined && pluginProps.content !== undefined` before registering the panel, so title is
 * required at runtime and content is required too, despite being optional in the published type. The
 * omission is a gap in the declarations, not a deprecation.
 *
 * No cast is involved, and none was needed: TypeScript does not flag the extra property here, because
 * definePlugin's parameter returns the union `Plugin | Promise<Plugin>` and object-literal freshness
 * checks do not fire against it -- verified by compiling a return with a deliberately nonsense key,
 * which was accepted as readily as title. That is precisely why this interface exists rather than an
 * inline object: an annotated return restores the check, so a misspelt `content` is a compile error
 * here instead of a panel that silently fails to register.
 *
 * plugin.json's common_name is a separate string and cannot replace this one; it names the plugin in
 * Millennium's plugin list, while title names the sidebar page. They are kept identical on purpose.
 *
 * JSX is imported from react rather than reached for as a global namespace, which React 19's types no
 * longer declare.
 */
interface SidebarPlugin extends Plugin {
	title: string;
	content: JSX.Element;
}

export default definePlugin(
	(): SidebarPlugin => ({
		title: 'CS2Tracker Extension',
		icon: <CS2TrackerIcon />,
		content: <SettingsPanel />,
	}),
);
