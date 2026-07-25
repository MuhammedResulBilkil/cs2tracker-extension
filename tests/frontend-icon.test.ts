import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CS2TrackerIcon } from '../frontend/assets/Icon';

/**
 * frontend/assets/Icon.tsx is a hand transcription of assets/icon.svg, and a transcription can drift
 * from its source in silence: a dropped shape, a reordered pair, a mistyped digit, or an attribute
 * React quietly discards all still render something icon-shaped. This suite reads the asset from disk
 * and compares it against the component's own element tree, so the two cannot disagree unnoticed.
 *
 * No renderer is involved and none is needed. CS2TrackerIcon is a plain function of no arguments, so
 * calling it returns the React element it describes, which is the thing worth asserting on -- mounting
 * it would only add a DOM that normalises away exactly the mistakes being looked for.
 *
 * fileURLToPath is given a string, not a URL object: the happy-dom test environment replaces the
 * global URL constructor, and Node rejects the resulting foreign instance.
 */
const ASSET_PATH = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'icon.svg');
const ASSET = readFileSync(ASSET_PATH, 'utf8');

/** Every shape element in the asset, as its raw source tag. */
const ASSET_TAGS = [...ASSET.matchAll(/<path\b[^>]*>/g)].map(([tag]) => tag);

const attribute = (tag: string, name: string): string | undefined =>
	new RegExp(`\\b${name}="([^"]*)"`).exec(tag)?.[1];

const ASSET_SHAPES = ASSET_TAGS.map((tag) => ({ fill: attribute(tag, 'fill'), d: attribute(tag, 'd') }));

const icon = CS2TrackerIcon();
const children = icon.props.children as Array<{ type: unknown; props: Record<string, unknown> }>;

describe('the asset the icon is transcribed from', () => {
	// The comparisons below are only as trustworthy as this reader. If the trace ever emits a shape the
	// regex above cannot see, everything downstream would compare a shorter list against a shorter list
	// and pass.
	it('yields five readable shapes', () => {
		expect(ASSET_TAGS).toHaveLength(5);
		expect(ASSET_SHAPES.filter((shape) => shape.fill === undefined || shape.d === undefined)).toEqual([]);
	});

	/**
	 * A canary for the transcription, not a fact about SVG. `fill` and `d` are spelled identically in
	 * React, so today's transcription needs no conversion at all; the moment the trace emits fill-rule,
	 * clip-rule, or stroke-width, the literal spelling would be dropped by React without a warning and
	 * the mark would render wrong. Failing here forces the camelCase conversion to be made deliberately.
	 */
	it('uses only attributes React spells the same way', () => {
		const names = [...new Set(ASSET_TAGS.flatMap((tag) => [...tag.matchAll(/\s([a-zA-Z-]+)=/g)].map(([, name]) => name)))];
		expect(names.sort()).toEqual(['d', 'fill']);
	});
});

describe('CS2TrackerIcon', () => {
	it('is an svg element in the SVG namespace', () => {
		expect(icon.type).toBe('svg');
		expect(icon.props.xmlns).toBe('http://www.w3.org/2000/svg');
	});

	/**
	 * The mark's arcs share an off-centre origin at (22.62, 22.62) of this box, so the viewBox is
	 * geometry rather than packaging: re-cropping it to something centred or square shifts every arc.
	 * Pinned against the asset as well as against the literal, so tidying one file cannot pass by
	 * matching the other.
	 */
	it('keeps the asset viewBox verbatim', () => {
		expect(icon.props.viewBox).toBe('0 0 40 40');
		expect(ASSET).toContain('viewBox="0 0 40 40"');
	});

	/**
	 * The whole transcription in one assertion: shape count, every coordinate, every fill, and the order
	 * they are painted in. Order is not cosmetic here -- two shapes carry #ffffff and two carry #007aef,
	 * so a swap within either pair is invisible in a diff of the colours alone and visible on screen.
	 */
	it('carries every shape from the asset, in the asset order', () => {
		expect(children.map((child) => child.type)).toEqual(['path', 'path', 'path', 'path', 'path']);
		expect(children.map(({ props }) => ({ fill: props.fill, d: props.d }))).toEqual(ASSET_SHAPES);
	});

	// Restates the fill order as literals. The comparison above would still pass if both files were
	// edited together, and the palette is the part a reviewer recognises at a glance.
	it('paints the documented fill order', () => {
		expect(children.map(({ props }) => props.fill)).toEqual(['#7f8181', '#ffffff', '#007aef', '#ffffff', '#007aef']);
	});

	/**
	 * No hyphenated prop can reach React except an aria-/data- attribute, which React passes through
	 * unchanged. This is the check that catches a fill-rule or stroke-width transcribed literally from a
	 * future asset: React drops those silently, so nothing else here or on screen would report it.
	 */
	it('spells every attribute the way React requires', () => {
		const names = [icon.props, ...children.map((child) => child.props)].flatMap((props) => Object.keys(props));
		expect(names.filter((name) => name.includes('-') && !/^(aria|data)-/.test(name))).toEqual([]);
	});

	// Task 11 mounts this beside label text inside Steam's own components, so it has to track their font
	// size rather than a fixed pixel box. This is the one intentional difference from the asset, which
	// carries width="40" height="40" for standalone use.
	it('sizes itself in em so it inherits the surrounding text size', () => {
		expect(icon.props.style).toEqual({ height: '1em', width: '1em' });
		expect(icon.props.width).toBeUndefined();
		expect(icon.props.height).toBeUndefined();
	});

	// The mark is decoration next to a label that already names the setting; announcing it would read the
	// same thing twice.
	it('hides itself from assistive technology', () => {
		expect(icon.props['aria-hidden']).toBe('true');
	});

	it('takes no props', () => {
		expect(CS2TrackerIcon).toHaveLength(0);
	});

	// A component returning one shared element would have every mount point re-parent the same node.
	it('describes a fresh element tree on every call', () => {
		expect(CS2TrackerIcon()).not.toBe(icon);
	});

	// The mark is a true vector. The asset it comes from was traced precisely to get away from the
	// base64 raster CS2Tracker publishes, and a regressed trace would put that raster back.
	it('is a vector, with no embedded raster', () => {
		expect(children.every((child) => child.type === 'path')).toBe(true);
		expect(ASSET).not.toContain('base64');
		expect(ASSET).not.toContain('<image');
	});
});
