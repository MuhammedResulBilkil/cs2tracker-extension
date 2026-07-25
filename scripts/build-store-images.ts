/**
 * Renders the two images the plugin store shows for this plugin.
 *
 * `thumbnail` is the card in the store's plugin grid; `splash_image` is the backdrop on the plugin's
 * own page. Both are referenced from `plugin.json` by absolute `raw.githubusercontent.com` URL, so
 * both are committed rather than generated at install time — the store fetches them over HTTP and
 * never runs this script.
 *
 * One composition at two sizes: the mark, the plugin's name, and a one-line summary, stacked and
 * centred on a dark field with an accent glow. 1280x720 and 1920x1080 — both 16:9, both above the
 * upstream schema's minimums of 512x288 and 1920x1080.
 *
 * Nothing here is laid out from guessed metrics. Every position comes from a measurement taken by
 * rasterising the thing being placed and finding its ink:
 *
 *   - The mark is placed on its measured ink bounding box, not on its `viewBox`. The five arcs in
 *     `assets/icon.svg` share an origin at (22.62, 22.62) of a `0 0 40 40` box, so the mark's
 *     `viewBox` centre is emphatically not its arc centre — see `MARK_CENTRING` below for what that
 *     does and does not imply, because the intuitive correction is the wrong one.
 *   - Text is placed on its measured ascent, descent and advance width. librsvg resolves the font
 *     stack against whatever fontconfig offers, so the only honest source for a glyph's extent is a
 *     render of that glyph at that size.
 *
 * The layout is then asserted rather than eyeballed: nothing may come within `MIN_MARGIN` of an
 * edge, and no two stacked elements may overlap. After rendering, each element's ink is recovered
 * from the finished PNG by differencing it against a background-only render, and compared with where
 * the layout said it would be. That last step is what catches a font substitution, a clipped mark, or
 * text that overflowed — failures that dimensions and aspect ratio cannot see.
 *
 * Run it with `pnpm run build-store-images`, then look at the two files.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ICON_FILE = fileURLToPath(new URL('../assets/icon.svg', import.meta.url));
const ASSETS = new URL('../assets/', import.meta.url);

const BACKGROUND = '#0b0f16';
const ACCENT = '#007aef';
const TITLE_COLOUR = '#ffffff';
const SUBTITLE_COLOUR = '#8b95ad';

/**
 * Resolved by fontconfig inside librsvg, so the first name that exists on the rendering machine
 * wins. `measureText` fails the build if the chosen face renders no ink, and `verify` fails it if the
 * glyphs land somewhere other than where they were measured — between them, a substitution that
 * changes the layout cannot pass silently.
 */
const FONT = 'Arial, Helvetica, sans-serif';

const TITLE = 'CS2Tracker Extension';
const SUBTITLE = 'CS2 stats links on Steam profiles and friend lists';

/**
 * The mark is placed by aligning its measured ink bounding box centre with the layout's axis.
 *
 * The tempting alternative is to align the arcs' shared origin, (22.62, 22.62) of a 40-unit box,
 * on the grounds that a broken ring is read from its centre. Measured, that is the one clearly wrong
 * choice. Casting rays and fitting a circle to the mark's outer silhouette puts the best-fit disc
 * centre at (20.332, 20.332) with the silhouette's radius varying 8.1% about it; about the `viewBox`
 * centre it varies 8.4%, and about the arc origin 13.9%. The original mark compensates for its
 * off-centre arc origin by giving the top-left quadrant a larger outer radius — 22.614 against
 * 17.432 for the other three — which squares the ink box up: the measured box is 0..40 on both axes,
 * centre (19.98, 19.98).
 *
 * The two optical proxies also bracket that centre from opposite sides. The alpha-weighted centroid
 * is (19.695, 19.695), 0.8% up and left; the best-fit disc centre is 0.8% down and right. Their
 * midpoint is (20.014, 20.014), within 0.07% of the ink box centre. There is no correction to make,
 * so none is made — but the box is measured from the file rather than read off the `viewBox`
 * attribute, so a re-trace that did shift the ink would move the mark with it. `CENTROID_TOLERANCE`
 * is the guard on the argument itself: if the centroid ever drifts far from the box centre, this
 * reasoning no longer holds and the build stops rather than quietly mis-placing the mark.
 */
const MARK_CENTRING = 'ink bounding box';

/** How far the alpha-weighted centroid may sit from the ink box centre, as a fraction of the box. */
const CENTROID_TOLERANCE = 0.02;

/** Side of the square raster used to measure the mark. Large enough that one pixel is ~0.03 units. */
const MARK_PROBE = 1024;

/** Canvas the base metrics below are expressed in. Every target is this layout, scaled. */
const BASE_WIDTH = 1280;

/**
 * Ink extent of the mark, px at `BASE_WIDTH`. The mark is square, so this is both width and height.
 *
 * These three sizes were settled by rendering the thumbnail down to the 280-440px the store's grid
 * cards occupy and reading it there, which is the size that decides whether the card works. At the
 * mark's first size, 200px, the title carried the card on its own and the mark was a 44px smudge —
 * the wrong way round for a grid a user scans by logo. The mark grew until it anchored the card at
 * 280px, and the title gave back just enough to keep the stack centred.
 *
 * The subtitle cannot be read below roughly a 400px card at any size that also fits the canvas, so it
 * is treated as a full-size and plugin-page element rather than a card one: shrinking it costs
 * nothing where it was already illegible and buys a clear width step under the title (57% of the
 * canvas against the title's 65%), where at 40px the two lines were within 3% of each other and read
 * as one block of text.
 */
const MARK_EXTENT = 300;
const TITLE_SIZE = 80;
const SUBTITLE_SIZE = 34;

/** Mark's lowest ink to the title's highest ink, px at `BASE_WIDTH`. */
const GAP_MARK_TITLE = 60;

/** Title's lowest ink to the subtitle's highest ink, px at `BASE_WIDTH`. */
const GAP_TITLE_SUBTITLE = 28;

/** Closest any ink may come to a canvas edge, px at `BASE_WIDTH`. */
const MIN_MARGIN = 56;

/** Per-channel difference from the background render that counts a pixel as ink. */
const INK_THRESHOLD = 24;

/** How far a rendered element's ink may sit from where the layout put it, px. Antialiasing only. */
const PLACEMENT_TOLERANCE = 3;

/** Floor for the WCAG contrast of each of the mark's fills against the field behind it. */
const MIN_CONTRAST = 3;

interface Target {
	file: string;
	width: number;
	height: number;
	/** Store minimum for this slot, from the upstream plugin schema. */
	minWidth: number;
	minHeight: number;
}

const TARGETS: readonly Target[] = [
	{ file: 'thumbnail.png', width: 1280, height: 720, minWidth: 512, minHeight: 288 },
	{ file: 'splash.png', width: 1920, height: 1080, minWidth: 1920, minHeight: 1080 },
];

/** An axis-aligned rectangle, `x1`/`y1` exclusive. */
interface Box {
	x0: number;
	y0: number;
	x1: number;
	y1: number;
}

interface Rgb {
	r: number;
	g: number;
	b: number;
}

class ImageError extends Error {}

function fail(message: string): never {
	throw new ImageError(message);
}

function escapeXml(text: string): string {
	return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function boxWidth(box: Box): number {
	return box.x1 - box.x0;
}

function boxHeight(box: Box): number {
	return box.y1 - box.y0;
}

function formatBox(box: Box): string {
	return `x ${box.x0.toFixed(1)}..${box.x1.toFixed(1)} y ${box.y0.toFixed(1)}..${box.y1.toFixed(1)}`;
}

// --- measurement ------------------------------------------------------------------------------

interface Raster {
	data: Buffer;
	width: number;
	height: number;
}

async function rasterise(svg: string, density: number): Promise<Raster> {
	const { data, info } = await sharp(Buffer.from(svg), { density })
		.ensureAlpha()
		.raw()
		.toBuffer({ resolveWithObject: true });
	return { data, width: info.width, height: info.height };
}

/**
 * Bounding box of the pixels at least half covered, plus the alpha-weighted centroid of every
 * partly covered pixel. Half coverage is the same threshold `trace-icon.ts` classifies on, which
 * puts the box on the shape's 50% contour rather than on the outer fringe of its antialiasing.
 */
function inkOf(raster: Raster): { box: Box; cx: number; cy: number } | undefined {
	let x0 = Infinity;
	let y0 = Infinity;
	let x1 = -Infinity;
	let y1 = -Infinity;
	let mass = 0;
	let mx = 0;
	let my = 0;
	for (let y = 0; y < raster.height; y++) {
		for (let x = 0; x < raster.width; x++) {
			const alpha = raster.data[(y * raster.width + x) * 4 + 3];
			if (alpha === 0) continue;
			if (alpha >= 128) {
				if (x < x0) x0 = x;
				if (y < y0) y0 = y;
				if (x + 1 > x1) x1 = x + 1;
				if (y + 1 > y1) y1 = y + 1;
			}
			const weight = alpha / 255;
			mass += weight;
			mx += weight * (x + 0.5);
			my += weight * (y + 0.5);
		}
	}
	if (mass === 0 || !Number.isFinite(x0)) return undefined;
	return { box: { x0, y0, x1, y1 }, cx: mx / mass, cy: my / mass };
}

interface Mark {
	/** Markup between the icon's own `<svg>` tags, to be re-parented under a transform. */
	inner: string;
	/** Side of the icon's square `viewBox`, in user units. */
	view: number;
	/** Ink bounding box, in user units. */
	box: Box;
	/** Alpha-weighted centroid, in user units. Reported and guarded, not used to place the mark. */
	cx: number;
	cy: number;
}

/**
 * Reads `assets/icon.svg` and measures where its ink actually is.
 *
 * The icon is re-parented under a `<g transform>` rather than nested as a child `<svg>` with `x`,
 * `y`, `width` and `height`. Nesting it means writing a second `width` onto an element that already
 * has one, and duplicate attributes are an XML parse error, not a last-one-wins override: librsvg
 * rejects the whole document with `Attribute height redefined` and sharp reports it as a corrupt
 * header. A transform also states the placement as one translate and one scale, which is what the
 * layout has to reason about anyway.
 */
async function readMark(): Promise<Mark> {
	const svg = readFileSync(ICON_FILE, 'utf8');
	const viewBox = /viewBox\s*=\s*"([^"]+)"/.exec(svg);
	if (!viewBox) fail(`${ICON_FILE} has no viewBox`);
	const numbers = viewBox[1].trim().split(/[\s,]+/).map(Number);
	if (numbers.length !== 4 || numbers.some((n) => !Number.isFinite(n))) {
		fail(`${ICON_FILE} has an unreadable viewBox: ${viewBox[1]}`);
	}
	const [minX, minY, view, height] = numbers;
	if (minX !== 0 || minY !== 0 || view !== height) {
		fail(`expected a square viewBox at the origin, got "${viewBox[1]}"`);
	}

	const inner = svg
		.replace(/^[\s\S]*?<svg[^>]*>/, '')
		.replace(/<\/svg>\s*$/, '')
		.trim();
	if (!inner.includes('<path')) fail(`${ICON_FILE} holds no path data`);

	// `density` scales rasterisation itself, so the arcs are drawn at MARK_PROBE px rather than drawn
	// at `view` px and blown up. Same arithmetic as `trace-icon.ts`: sharp's baseline is 72 dpi, so
	// the density that renders `view` user units into MARK_PROBE pixels is 72 * MARK_PROBE / view.
	const ink = inkOf(await rasterise(svg, (72 * MARK_PROBE) / view));
	if (!ink) fail(`${ICON_FILE} rendered no ink`);

	const toUnits = (px: number) => (px / MARK_PROBE) * view;
	const mark: Mark = {
		inner,
		view,
		box: { x0: toUnits(ink.box.x0), y0: toUnits(ink.box.y0), x1: toUnits(ink.box.x1), y1: toUnits(ink.box.y1) },
		cx: toUnits(ink.cx),
		cy: toUnits(ink.cy),
	};

	const centreX = (mark.box.x0 + mark.box.x1) / 2;
	const centreY = (mark.box.y0 + mark.box.y1) / 2;
	const drift = Math.max(Math.abs(mark.cx - centreX), Math.abs(mark.cy - centreY)) / view;
	console.log(
		`mark: ink box ${formatBox(mark.box)} of ${view}, box centre ` +
			`(${centreX.toFixed(3)}, ${centreY.toFixed(3)}), centroid (${mark.cx.toFixed(3)}, ${mark.cy.toFixed(3)})`,
	);
	console.log(`      centred on its ${MARK_CENTRING}; centroid drifts ${(drift * 100).toFixed(2)}% of the box`);
	if (drift > CENTROID_TOLERANCE) {
		fail(
			`the mark's centroid sits ${(drift * 100).toFixed(2)}% of its box from the box centre, over the ` +
				`${(CENTROID_TOLERANCE * 100).toFixed(0)}% this script's centring argument assumes\n` +
				'  the mark has become lopsided enough that the ink box is no longer its optical centre; ' +
				'decide where it belongs before regenerating',
		);
	}
	return mark;
}

interface TextMetrics {
	/** Advance-independent ink width, px. */
	width: number;
	/** Ink above the baseline, px. */
	ascent: number;
	/** Ink below the baseline, px. */
	descent: number;
}

/**
 * Measures one line of text as the font actually renders it.
 *
 * The line is drawn on an oversized transparent canvas at a known baseline and its ink box read
 * back, so `width` is the inked extent rather than a sum of advance widths, and `ascent`/`descent`
 * are this face's real overshoot at this size rather than the nominal em box.
 */
async function measureText(text: string, size: number, weight: number): Promise<TextMetrics> {
	const width = Math.ceil(size * text.length * 1.2) + 200;
	const height = Math.ceil(size * 3);
	const baseline = Math.round(size * 1.5);
	const svg =
		`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">` +
		`<text x="100" y="${baseline}" fill="#ffffff" font-family="${FONT}" font-size="${size}" ` +
		`font-weight="${weight}">${escapeXml(text)}</text></svg>`;
	const ink = inkOf(await rasterise(svg, 72));
	if (!ink) {
		fail(
			`no glyphs rendered for ${JSON.stringify(text)} at ${size}px/${weight}\n` +
				`  fontconfig resolved none of "${FONT}" to a usable face on this machine`,
		);
	}
	if (ink.box.x0 < 4 || ink.box.x1 > width - 4 || ink.box.y0 < 4 || ink.box.y1 > height - 4) {
		fail(`measurement canvas too small for ${JSON.stringify(text)} at ${size}px: ink ${formatBox(ink.box)}`);
	}
	return {
		width: boxWidth(ink.box),
		ascent: baseline - ink.box.y0,
		descent: ink.box.y1 - baseline,
	};
}

// --- layout -----------------------------------------------------------------------------------

interface Placement {
	name: string;
	/** Where this element's ink lands on the canvas. */
	box: Box;
}

interface Layout {
	target: Target;
	scale: number;
	/** `translate` and uniform `scale` that put the mark's ink box at `mark.box`. */
	markTranslate: { x: number; y: number };
	markScale: number;
	titleSize: number;
	subtitleSize: number;
	titleBaseline: number;
	subtitleBaseline: number;
	placements: Placement[];
}

/**
 * Stacks mark, title and subtitle from measured extents and centres the stack.
 *
 * Vertical placement packs ink boxes with the measured gaps, because what reads as the spacing
 * between two lines is the distance between their ink, not between their baselines or their em
 * boxes. Horizontal placement puts each element's ink centre on the canvas centre line — for the
 * text that is what `text-anchor="middle"` does to the advance width, and the difference between
 * advance and ink is a fraction of a pixel of side bearing at these sizes.
 */
function layOut(target: Target, mark: Mark, title: TextMetrics, subtitle: TextMetrics, scale: number): Layout {
	const markExtent = MARK_EXTENT * scale;
	const gapMarkTitle = GAP_MARK_TITLE * scale;
	const gapTitleSubtitle = GAP_TITLE_SUBTITLE * scale;

	const markInk = Math.max(boxWidth(mark.box), boxHeight(mark.box));
	const markScale = markExtent / markInk;

	const stackHeight =
		boxHeight(mark.box) * markScale +
		gapMarkTitle +
		(title.ascent + title.descent) +
		gapTitleSubtitle +
		(subtitle.ascent + subtitle.descent);

	const cx = target.width / 2;
	const top = (target.height - stackHeight) / 2;

	const markBox: Box = {
		x0: cx - (boxWidth(mark.box) * markScale) / 2,
		y0: top,
		x1: cx + (boxWidth(mark.box) * markScale) / 2,
		y1: top + boxHeight(mark.box) * markScale,
	};
	const titleTop = markBox.y1 + gapMarkTitle;
	const titleBaseline = titleTop + title.ascent;
	const titleBox: Box = {
		x0: cx - title.width / 2,
		y0: titleTop,
		x1: cx + title.width / 2,
		y1: titleBaseline + title.descent,
	};
	const subtitleTop = titleBox.y1 + gapTitleSubtitle;
	const subtitleBaseline = subtitleTop + subtitle.ascent;
	const subtitleBox: Box = {
		x0: cx - subtitle.width / 2,
		y0: subtitleTop,
		x1: cx + subtitle.width / 2,
		y1: subtitleBaseline + subtitle.descent,
	};

	// The transform maps the icon's user units onto the canvas. `markTranslate` is where user-unit
	// (0, 0) has to land for the *ink* box — which need not start at (0, 0) — to land on `markBox`.
	return {
		target,
		scale,
		markTranslate: { x: markBox.x0 - mark.box.x0 * markScale, y: markBox.y0 - mark.box.y0 * markScale },
		markScale,
		titleSize: TITLE_SIZE * scale,
		subtitleSize: SUBTITLE_SIZE * scale,
		titleBaseline,
		subtitleBaseline,
		placements: [
			{ name: 'mark', box: markBox },
			{ name: 'title', box: titleBox },
			{ name: 'subtitle', box: subtitleBox },
		],
	};
}

/** Fails unless every element clears the canvas edges and no two of them overlap. */
function assertLayout(layout: Layout): void {
	const margin = MIN_MARGIN * layout.scale;
	const { width, height } = layout.target;
	for (const { name, box } of layout.placements) {
		const clearances = [box.x0, box.y0, width - box.x1, height - box.y1];
		const tightest = Math.min(...clearances);
		if (tightest < margin) {
			fail(
				`${layout.target.file}: ${name} comes within ${tightest.toFixed(1)}px of a canvas edge, ` +
					`under the ${margin.toFixed(0)}px minimum (${formatBox(box)} on ${width}x${height})`,
			);
		}
		console.log(
			`  ${name.padEnd(8)} ${formatBox(box)}  ${boxWidth(box).toFixed(0)}x${boxHeight(box).toFixed(0)}` +
				`  clearance ${tightest.toFixed(0)}px`,
		);
	}
	for (let i = 1; i < layout.placements.length; i++) {
		const above = layout.placements[i - 1];
		const below = layout.placements[i];
		const overlapX = Math.min(above.box.x1, below.box.x1) - Math.max(above.box.x0, below.box.x0);
		const overlapY = above.box.y1 - below.box.y0;
		if (overlapX > 0 && overlapY > 0) {
			fail(
				`${layout.target.file}: ${above.name} and ${below.name} overlap by ${overlapY.toFixed(1)}px ` +
					'vertically over a shared horizontal span — reduce the type or open the gap',
			);
		}
	}
}

// --- rendering --------------------------------------------------------------------------------

/** Which layers to draw. `false` for all three yields the background alone, for differencing. */
interface Layers {
	mark: boolean;
	title: boolean;
	subtitle: boolean;
}

function compose(layout: Layout, mark: Mark, layers: Layers): string {
	const { width, height } = layout.target;
	const cx = width / 2;
	const parts = [
		`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
		'<defs>',
		'<radialGradient id="glow" cx="50%" cy="38%" r="62%">',
		`<stop offset="0%" stop-color="${ACCENT}" stop-opacity="0.18"/>`,
		`<stop offset="100%" stop-color="${ACCENT}" stop-opacity="0"/>`,
		'</radialGradient>',
		'</defs>',
		`<rect width="100%" height="100%" fill="${BACKGROUND}"/>`,
		'<rect width="100%" height="100%" fill="url(#glow)"/>',
	];
	if (layers.mark) {
		const { x, y } = layout.markTranslate;
		const n = (v: number) => Number(v.toFixed(4)).toString();
		parts.push(`<g transform="translate(${n(x)} ${n(y)}) scale(${n(layout.markScale)})">${mark.inner}</g>`);
	}
	if (layers.title) {
		parts.push(
			`<text x="${cx}" y="${layout.titleBaseline.toFixed(2)}" fill="${TITLE_COLOUR}" font-family="${FONT}" ` +
				`font-size="${layout.titleSize}" font-weight="700" text-anchor="middle">${escapeXml(TITLE)}</text>`,
		);
	}
	if (layers.subtitle) {
		parts.push(
			`<text x="${cx}" y="${layout.subtitleBaseline.toFixed(2)}" fill="${SUBTITLE_COLOUR}" ` +
				`font-family="${FONT}" font-size="${layout.subtitleSize}" text-anchor="middle">` +
				`${escapeXml(SUBTITLE)}</text>`,
		);
	}
	parts.push('</svg>');
	return parts.join('\n');
}

/**
 * Renders a composition at exactly its declared pixel size.
 *
 * The root `<svg>` declares `width` and `height` in pixels, so the density that renders it 1:1 is
 * sharp's 72 dpi baseline — the mark's paths are then rasterised at canvas resolution by the
 * transform, with no intermediate bitmap to resample. Asserted rather than assumed: a density
 * mismatch would silently scale the whole canvas.
 */
async function render(svg: string, target: Target): Promise<Raster> {
	const raster = await rasterise(svg, 72);
	if (raster.width !== target.width || raster.height !== target.height) {
		fail(
			`${target.file}: rendered ${raster.width}x${raster.height} from an SVG declaring ` +
				`${target.width}x${target.height}`,
		);
	}
	return raster;
}

/** Bounding box of pixels differing from `background` by more than `INK_THRESHOLD` on any channel. */
function differenceBox(full: Raster, background: Raster, within: Box): Box | undefined {
	let x0 = Infinity;
	let y0 = Infinity;
	let x1 = -Infinity;
	let y1 = -Infinity;
	const left = Math.max(0, Math.floor(within.x0));
	const right = Math.min(full.width, Math.ceil(within.x1));
	const topEdge = Math.max(0, Math.floor(within.y0));
	const bottom = Math.min(full.height, Math.ceil(within.y1));
	for (let y = topEdge; y < bottom; y++) {
		for (let x = left; x < right; x++) {
			const i = (y * full.width + x) * 4;
			const delta = Math.max(
				Math.abs(full.data[i] - background.data[i]),
				Math.abs(full.data[i + 1] - background.data[i + 1]),
				Math.abs(full.data[i + 2] - background.data[i + 2]),
			);
			if (delta <= INK_THRESHOLD) continue;
			if (x < x0) x0 = x;
			if (y < y0) y0 = y;
			if (x + 1 > x1) x1 = x + 1;
			if (y + 1 > y1) y1 = y + 1;
		}
	}
	return Number.isFinite(x0) ? { x0, y0, x1, y1 } : undefined;
}

function meanColour(raster: Raster, within: Box): Rgb {
	let r = 0;
	let g = 0;
	let b = 0;
	let n = 0;
	for (let y = Math.max(0, Math.floor(within.y0)); y < Math.min(raster.height, Math.ceil(within.y1)); y++) {
		for (let x = Math.max(0, Math.floor(within.x0)); x < Math.min(raster.width, Math.ceil(within.x1)); x++) {
			const i = (y * raster.width + x) * 4;
			r += raster.data[i];
			g += raster.data[i + 1];
			b += raster.data[i + 2];
			n++;
		}
	}
	return { r: r / n, g: g / n, b: b / n };
}

function parseHex(hex: string): Rgb {
	const m = /^#([0-9a-f]{6})$/i.exec(hex);
	if (!m) fail(`not a six-digit hex colour: ${hex}`);
	const v = parseInt(m[1], 16);
	return { r: (v >> 16) & 255, g: (v >> 8) & 255, b: v & 255 };
}

/** WCAG relative luminance. */
function luminance({ r, g, b }: Rgb): number {
	const channel = (v: number) => {
		const s = v / 255;
		return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
	};
	return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrast(a: Rgb, b: Rgb): number {
	const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
	return (hi + 0.05) / (lo + 0.05);
}

/** Every distinct `fill` in the mark's markup. */
function markFills(mark: Mark): string[] {
	return [...new Set([...mark.inner.matchAll(/fill="(#[0-9a-fA-F]{6})"/g)].map((m) => m[1].toLowerCase()))];
}

/**
 * Confirms the finished raster shows what the layout described.
 *
 * Each element is rendered once with the others suppressed and differenced against a
 * background-only render, which isolates its ink from the gradient behind it and from the other two
 * elements. The recovered box is then compared with the planned one — this is what would catch a
 * substituted font, a mark placed by the wrong transform, or text wider than its measurement.
 *
 * The mark's fills are also checked against the field actually behind them. Two of the five paths
 * are `#ffffff`; on a light field those two quadrants vanish and the mark reads as broken, so the
 * dark canvas is load-bearing and worth asserting rather than assuming.
 */
async function verify(layout: Layout, mark: Mark): Promise<void> {
	const canvas: Box = { x0: 0, y0: 0, x1: layout.target.width, y1: layout.target.height };
	const background = await render(compose(layout, mark, { mark: false, title: false, subtitle: false }), layout.target);

	for (const { name, box } of layout.placements) {
		const only: Layers = { mark: name === 'mark', title: name === 'title', subtitle: name === 'subtitle' };
		const isolated = await render(compose(layout, mark, only), layout.target);
		// Search the whole canvas, not just the planned box: an element that landed outside its box is
		// exactly the failure being looked for, and a search clipped to the box could not see it.
		const found = differenceBox(isolated, background, canvas);
		if (!found) fail(`${layout.target.file}: ${name} rendered no visible ink`);
		const drift = Math.max(
			Math.abs(found.x0 - box.x0),
			Math.abs(found.y0 - box.y0),
			Math.abs(found.x1 - box.x1),
			Math.abs(found.y1 - box.y1),
		);
		console.log(`  ${name.padEnd(8)} rendered ${formatBox(found)}  drift ${drift.toFixed(1)}px`);
		if (drift > PLACEMENT_TOLERANCE) {
			fail(
				`${layout.target.file}: ${name} rendered at ${formatBox(found)} but the layout put it at ` +
					`${formatBox(box)} — ${drift.toFixed(1)}px out, over the ${PLACEMENT_TOLERANCE}px tolerance`,
			);
		}
	}

	const markBox = layout.placements[0].box;
	const field = meanColour(background, markBox);
	console.log(
		`  field behind the mark: rgb(${field.r.toFixed(0)}, ${field.g.toFixed(0)}, ${field.b.toFixed(0)})`,
	);
	for (const fill of markFills(mark)) {
		const ratio = contrast(parseHex(fill), field);
		console.log(`  ${fill} on that field: ${ratio.toFixed(2)}:1`);
		if (ratio < MIN_CONTRAST) {
			fail(
				`${layout.target.file}: the mark's ${fill} fill has only ${ratio.toFixed(2)}:1 against the field ` +
					`behind it, under the ${MIN_CONTRAST}:1 floor for a graphical object`,
			);
		}
	}
	const titleRatio = contrast(parseHex(TITLE_COLOUR), meanColour(background, layout.placements[1].box));
	const subtitleRatio = contrast(parseHex(SUBTITLE_COLOUR), meanColour(background, layout.placements[2].box));
	console.log(`  title ${titleRatio.toFixed(2)}:1, subtitle ${subtitleRatio.toFixed(2)}:1`);
	// Both lines are large-scale text, whose WCAG AA floor is 3:1.
	for (const [name, ratio] of [['title', titleRatio], ['subtitle', subtitleRatio]] as Array<[string, number]>) {
		if (ratio < MIN_CONTRAST) {
			fail(`${layout.target.file}: ${name} has only ${ratio.toFixed(2)}:1 against its background`);
		}
	}
}

async function main(): Promise<void> {
	const mark = await readMark();

	for (const target of TARGETS) {
		if (target.width * 9 !== target.height * 16) {
			fail(`${target.file}: ${target.width}x${target.height} is not 16:9`);
		}
		if (target.width < target.minWidth || target.height < target.minHeight) {
			fail(
				`${target.file}: ${target.width}x${target.height} is under the store minimum of ` +
					`${target.minWidth}x${target.minHeight}`,
			);
		}

		const scale = target.width / BASE_WIDTH;
		const title = await measureText(TITLE, TITLE_SIZE * scale, 700);
		const subtitle = await measureText(SUBTITLE, SUBTITLE_SIZE * scale, 400);
		console.log(
			`\n${target.file} ${target.width}x${target.height} (scale ${scale}): title ink ` +
				`${title.width.toFixed(0)}x${(title.ascent + title.descent).toFixed(0)}, subtitle ink ` +
				`${subtitle.width.toFixed(0)}x${(subtitle.ascent + subtitle.descent).toFixed(0)}`,
		);

		const layout = layOut(target, mark, title, subtitle, scale);
		assertLayout(layout);

		const svg = compose(layout, mark, { mark: true, title: true, subtitle: true });
		await verify(layout, mark);

		// The same density `render` uses, and the metadata check below is the same assertion on the
		// artefact that actually ships rather than on an intermediate raster of it.
		const png = await sharp(Buffer.from(svg), { density: 72 })
			.png({ compressionLevel: 9, adaptiveFiltering: true })
			.toBuffer();
		const meta = await sharp(png).metadata();
		if (meta.width !== target.width || meta.height !== target.height) {
			fail(`${target.file}: encoded PNG is ${meta.width}x${meta.height}, expected ${target.width}x${target.height}`);
		}

		const path = fileURLToPath(new URL(target.file, ASSETS));
		writeFileSync(path, png);
		console.log(
			`  wrote ${path} — ${meta.width}x${meta.height}, ` +
				`${(meta.width / meta.height).toFixed(4)}:1, ${png.length} bytes`,
		);
	}
}

main().catch((error: unknown) => {
	if (error instanceof ImageError) console.error(`build-store-images: ${error.message}`);
	else console.error('build-store-images failed:', error);
	process.exit(1);
});
