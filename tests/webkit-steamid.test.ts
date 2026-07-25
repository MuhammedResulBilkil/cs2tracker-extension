import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveProfileSteamId } from '../webkit/steamid';

function makeDocument(html: string, href = 'https://steamcommunity.com/profiles/76561198145891996/'): Document {
	const doc = document.implementation.createHTMLDocument('test');
	doc.body.innerHTML = html;
	Object.defineProperty(doc, 'location', { value: { href }, configurable: true });
	return doc;
}

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('resolveProfileSteamId', () => {
	it('prefers g_rgProfileData.steamid64', async () => {
		const win = { g_rgProfileData: { steamid64: '76561198145891996', steamid: '11111111111111111' } };
		await expect(resolveProfileSteamId(makeDocument(''), win)).resolves.toBe('76561198145891996');
	});

	it('falls back to g_rgProfileData.steamid', async () => {
		const win = { g_rgProfileData: { steamid: '76561198145891996' } };
		await expect(resolveProfileSteamId(makeDocument(''), win)).resolves.toBe('76561198145891996');
	});

	it('ignores a zero or blank profile id', async () => {
		const win = { g_rgProfileData: { steamid64: '0', steamid: '   ' } };
		const doc = makeDocument('<div data-miniprofile="185626268"></div>');
		await expect(resolveProfileSteamId(doc, win)).resolves.toBe('76561198145891996');
	});

	it('converts data-miniprofile when no global is present', async () => {
		const doc = makeDocument('<div data-miniprofile="185626268"></div>');
		await expect(resolveProfileSteamId(doc, {})).resolves.toBe('76561198145891996');
	});

	it('falls back to the profile XML', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue({
				ok: true,
				text: async () => '<?xml version="1.0"?><profile><steamID64>76561198145891996</steamID64></profile>',
			}),
		);
		await expect(resolveProfileSteamId(makeDocument(''), {})).resolves.toBe('76561198145891996');
		expect(fetch).toHaveBeenCalledWith('https://steamcommunity.com/profiles/76561198145891996/?xml=1');
	});

	it('returns null when every strategy fails', async () => {
		vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
		await expect(resolveProfileSteamId(makeDocument(''), {})).resolves.toBeNull();
	});

	it('returns null on a non-ok XML response', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, text: async () => '' }));
		await expect(resolveProfileSteamId(makeDocument(''), {})).resolves.toBeNull();
	});

	// window.g_steamID holds the *signed-in* user's id, never the viewed profile's. If this module
	// ever read it, every button on every page would point at the viewer, and the bug would hide
	// because the viewer's own profile still looked right. The document here carries no other
	// signal and the XML fetch fails, so any non-null answer means g_steamID leaked into the chain.
	// fetch is stubbed rather than left alone because happy-dom's own fetch logs a CORS warning.
	it("never falls back to the signed-in user's g_steamID", async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, text: async () => '' }));
		const win = { g_steamID: '76561198000000001', g_rgProfileData: {} };
		await expect(resolveProfileSteamId(makeDocument(''), win)).resolves.toBeNull();
	});
});
