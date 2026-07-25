import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * `assets/icon-tile.svg` is the README's header mark, and it holds a fourth copy of the CS2Tracker
 * geometry -- after `assets/icon.svg` itself, `webkit/icon.ts` and `frontend/assets/Icon.tsx`, each of
 * which already has a suite pinning it to the asset for the same reason.
 *
 * It exists because neither generated variant can be used there. `icon.svg` puts a third of its ink in
 * `#ffffff`, which disappears against GitHub's light theme; `icon-mono.svg` fills with `currentColor`,
 * and an SVG loaded through `<img>` is an isolated document with no colour to inherit, so it renders
 * pure black and disappears against GitHub's dark theme. Measured, not assumed: rasterising the two at
 * 40px yields 315 blue / 193 white / 95 grey pixels for the first and 603 black pixels for the second.
 * The tile solves it by bringing its own background, so one file works under both themes.
 *
 * The drift this guards is the same one webkit/icon.ts documents: a future `pnpm run trace-icon` that
 * regenerates the asset would fail the frontend and webkit suites loudly while leaving this file
 * silently stale, and the README would then show a different mark from the plugin itself. Nothing about
 * "renders something icon-shaped" would give that away.
 *
 * fileURLToPath is given a string, not a URL object: the happy-dom test environment replaces the global
 * URL constructor, and Node rejects the resulting foreign instance. Same reason as the sibling suites.
 */
const ASSETS = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets');
const SOURCE = readFileSync(join(ASSETS, 'icon.svg'), 'utf8');
const TILE = readFileSync(join(ASSETS, 'icon-tile.svg'), 'utf8');

/** Every `<path>` element, as its exact `fill` and `d` pair, in document order. */
function pathsOf(svg: string): Array<{ fill: string; d: string }> {
	return [...svg.matchAll(/<path\s+fill="([^"]+)"\s+d="([^"]+)"\s*\/>/g)].map((match) => ({
		fill: match[1],
		d: match[2],
	}));
}

const sourcePaths = pathsOf(SOURCE);
const tilePaths = pathsOf(TILE);

describe('assets/icon-tile.svg', () => {
	/**
	 * Guards every assertion below, all of which compare arrays. A regex that stopped matching -- a
	 * formatter reordering the attributes, wrapping the path data, or writing `<path d= ... fill= ...>`
	 * -- would empty both arrays and make the comparison pass over nothing at all.
	 */
	it('parses the same number of paths the mark actually has', () => {
		expect(sourcePaths).toHaveLength(5);
		expect(tilePaths).toHaveLength(5);
	});

	/**
	 * The whole point of the file: identical geometry and identical brand fills, in identical order. Not
	 * a spot check on one coordinate, because the failure being prevented is a single mistyped digit.
	 */
	it('carries the generated asset’s paths verbatim', () => {
		expect(tilePaths).toEqual(sourcePaths);
	});

	/**
	 * The `currentColor` trap, closed explicitly. Copying from `icon-mono.svg` instead of `icon.svg`
	 * would satisfy a path-count check and produce a tile that renders as a black mark on a near-black
	 * background -- invisible, and for a reason nobody would guess from looking at the markup.
	 */
	it('uses real colours rather than currentColor', () => {
		expect(TILE).not.toContain('currentColor');
		expect(tilePaths.map((path) => path.fill)).toContain('#007aef');
		expect(tilePaths.map((path) => path.fill)).toContain('#ffffff');
	});

	/**
	 * The background is what makes the white paths legible, so its absence is the whole failure. Pinned
	 * to `#0b0f16` because that is `BACKGROUND` in scripts/build-store-images.ts: the same field the
	 * store listing puts this mark on, and the one whose contrast against all three fills that script
	 * already asserts a WCAG floor for. Reusing it means the README tile inherits a checked result
	 * instead of a guess.
	 */
	it('brings its own dark field, matching the store images', () => {
		expect(TILE).toMatch(/<rect[^>]*fill="#0b0f16"/);
		expect(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'build-store-images.ts'), 'utf8')).toContain(
			"const BACKGROUND = '#0b0f16'",
		);
	});

	/**
	 * The mark spans the full 0-40 box, so a 48-box needs the group offset by 4 or the art is clipped on
	 * two sides. Both halves are asserted: a viewBox change without the translate, or the reverse, is
	 * the mistake that produces a cropped logo.
	 */
	it('insets the mark inside a larger box so nothing is clipped', () => {
		expect(TILE).toContain('viewBox="0 0 48 48"');
		expect(TILE).toContain('<g transform="translate(4 4)">');
		expect(SOURCE).toContain('viewBox="0 0 40 40"');
	});
});
