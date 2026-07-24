import { definePlugin, IconsModule } from '@steambrew/client';

export default definePlugin(() => {
	return {
		title: 'CS2Tracker Extension',
		icon: <IconsModule.Settings />,
		content: <div />,
	};
});
