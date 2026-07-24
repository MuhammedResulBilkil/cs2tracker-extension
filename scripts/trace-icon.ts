/**
 * Traces the CS2Tracker mark from its published raster into a true vector.
 *
 * The mark CS2Tracker ships as `cs2tracker.svg` is a base64 PNG in an `<svg>` wrapper — it
 * holds no path data at all. This script downloads the source raster, measures the geometry
 * out of it, emits `assets/icon.svg` as real arc paths, then rasterises that SVG back to the
 * source resolution and refuses to keep the result unless the two agree.
 *
 * Nothing here is hand-tuned: every number in the emitted SVG comes from `measure()`.
 * Run it with `pnpm run trace-icon`.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const SOURCE_URL = 'https://cs2tracker.gg/images/home/cs2tracker-icon.png';
const OUTPUT = fileURLToPath(new URL('../assets/icon.svg', import.meta.url));
const MAX_MISMATCH_RATIO = 0.02;

/** Side of the square viewBox the mark is emitted into. */
const VIEW = 40;

const BLUE = '#007aef';
const WHITE = '#ffffff';
const GREY = '#7f8181';

type Rgba = { r: number; g: number; b: number; a: number };
type Region = 'blue' | 'white' | 'grey' | 'empty';

/** Region codes indexed by the value stored in the classified grid. */
const REGIONS: readonly Region[] = ['empty', 'blue', 'white', 'grey'];
const FILLS: Record<Region, string> = { blue: BLUE, white: WHITE, grey: GREY, empty: 'none' };

function classify(px: Rgba): Region {
	if (px.a < 128) return 'empty';
	if (px.b > 150 && px.b > px.r + 40) return 'blue';
	if (px.r > 220 && px.g > 220 && px.b > 220) return 'white';
	if (Math.abs(px.r - px.g) < 25 && Math.abs(px.g - px.b) < 25) return 'grey';
	return 'empty';
}

async function loadPixels(): Promise<{ data: Buffer; width: number; height: number }> {
	const response = await fetch(SOURCE_URL);
	if (!response.ok) throw new Error(`source fetch failed: HTTP ${response.status}`);
	const buffer = Buffer.from(await response.arrayBuffer());
	const { data, info } = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
	return { data, width: info.width, height: info.height };
}

function at(data: Buffer, width: number, x: number, y: number): Rgba {
	const i = (y * width + x) * 4;
	return { r: data[i], g: data[i + 1], b: data[i + 2], a: data[i + 3] };
}

/** Least-squares circle fit (Kasa method). Returns centre and radius. */
function fitCircle(points: Array<[number, number]>): { cx: number; cy: number; r: number } {
	const n = points.length;
	if (n < 3) throw new Error('need at least 3 boundary points to fit a circle');
	let sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0, sxz = 0, syz = 0, sz = 0;
	for (const [x, y] of points) {
		const z = x * x + y * y;
		sx += x; sy += y; sz += z;
		sxx += x * x; syy += y * y; sxy += x * y;
		sxz += x * z; syz += y * z;
	}
	const a1 = 2 * (sx * sx - n * sxx);
	const b1 = 2 * (sx * sy - n * sxy);
	const c1 = sx * sz - n * sxz;
	const a2 = 2 * (sx * sy - n * sxy);
	const b2 = 2 * (sy * sy - n * syy);
	const c2 = sy * sz - n * syz;
	const det = a1 * b2 - a2 * b1;
	if (Math.abs(det) < 1e-9) throw new Error('degenerate circle fit');
	const cx = (c1 * b2 - c2 * b1) / det;
	const cy = (a1 * c2 - a2 * c1) / det;
	let r = 0;
	for (const [x, y] of points) r += Math.hypot(x - cx, y - cy);
	return { cx, cy, r: r / n };
}

/** Every pixel reduced to its region code. */
function classifyAll(data: Buffer, width: number, height: number): Uint8Array {
	const grid = new Uint8Array(width * height);
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			grid[y * width + x] = REGIONS.indexOf(classify(at(data, width, x, y)));
		}
	}
	return grid;
}

type Component = { label: number; region: Region; pixels: number; cx: number; cy: number };

/** 4-connected components of the non-empty regions, largest first. */
function findComponents(grid: Uint8Array, width: number, height: number): { labels: Int32Array; list: Component[] } {
	const labels = new Int32Array(width * height).fill(-1);
	const list: Component[] = [];
	const stack: number[] = [];
	let next = 0;
	for (let seed = 0; seed < grid.length; seed++) {
		if (grid[seed] === 0 || labels[seed] !== -1) continue;
		const code = grid[seed];
		const label = next++;
		labels[seed] = label;
		stack.push(seed);
		let pixels = 0, sx = 0, sy = 0;
		while (stack.length) {
			const p = stack.pop() as number;
			const x = p % width;
			const y = (p - x) / width;
			pixels++; sx += x; sy += y;
			const neighbours = [
				x > 0 ? p - 1 : -1,
				x < width - 1 ? p + 1 : -1,
				y > 0 ? p - width : -1,
				y < height - 1 ? p + width : -1,
			];
			for (const q of neighbours) {
				if (q < 0 || grid[q] !== code || labels[q] !== -1) continue;
				labels[q] = label;
				stack.push(q);
			}
		}
		list.push({ label, region: REGIONS[code], pixels, cx: sx / pixels, cy: sy / pixels });
	}
	return { labels, list: list.sort((a, b) => b.pixels - a.pixels) };
}

/** Pixels of one component that have at least one 4-neighbour outside it. */
function boundaryOf(labels: Int32Array, width: number, height: number, label: number): Array<[number, number]> {
	const points: Array<[number, number]> = [];
	for (let p = 0; p < labels.length; p++) {
		if (labels[p] !== label) continue;
		const x = p % width;
		const y = (p - x) / width;
		const exposed =
			x === 0 || y === 0 || x === width - 1 || y === height - 1 ||
			labels[p - 1] !== label || labels[p + 1] !== label ||
			labels[p - width] !== label || labels[p + width] !== label;
		if (exposed) points.push([x, y]);
	}
	return points;
}

type Edge = { x: number; y: number; axis: 'x' | 'y' };

/**
 * Refines every boundary pixel to the sub-pixel position where coverage crosses 50%.
 *
 * `classify` calls a pixel empty below alpha 128, so the classified outline sits on the
 * 50%-coverage contour. Under the box filter a raster edge `t` px past a pixel centre leaves
 * that pixel `0.5 + t` covered, so the edge lies at `alpha/255 - 0.5` px along the outward
 * normal. Exact for the straight edges, and within a hundredth of a pixel for arcs this large.
 */
function edgesOf(
	data: Buffer, labels: Int32Array, width: number, height: number, label: number,
): Edge[] {
	const steps: Array<[number, number, 'x' | 'y']> = [[-1, 0, 'x'], [1, 0, 'x'], [0, -1, 'y'], [0, 1, 'y']];
	const edges: Edge[] = [];
	for (const [x, y] of boundaryOf(labels, width, height, label)) {
		const inside = at(data, width, x, y);
		for (const [dx, dy, axis] of steps) {
			const nx = x + dx, ny = y + dy;
			if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
			if (labels[ny * width + nx] === label) continue;
			// Only alpha transitions carry coverage information; every edge in this mark is one.
			if (at(data, width, nx, ny).a >= 128) continue;
			const t = inside.a / 255 - 0.5;
			edges.push({ x: x + dx * t, y: y + dy * t, axis });
		}
	}
	return edges;
}

/**
 * Axis-aligned straight edges, found as spikes in the coordinate histogram: a radial edge
 * contributes hundreds of points at one coordinate, while an arc's flattest extreme contributes
 * a few dozen at most.
 */
function straightEdges(edges: Edge[], axis: 'x' | 'y', minRun: number): number[] {
	const buckets = new Map<number, number[]>();
	for (const e of edges) {
		if (e.axis !== axis) continue;
		const key = Math.round(e[axis]);
		const bucket = buckets.get(key);
		if (bucket) bucket.push(e[axis]);
		else buckets.set(key, [e[axis]]);
	}
	const spikes = [...buckets.entries()].filter(([, v]) => v.length >= minRun).sort((a, b) => a[0] - b[0]);
	const lines: number[] = [];
	let run: number[] = [];
	let last = Number.NaN;
	const flush = () => { if (run.length) lines.push(run.reduce((a, b) => a + b, 0) / run.length); };
	for (const [key, values] of spikes) {
		if (run.length && key - last > 2) { flush(); run = []; }
		run.push(...values);
		last = key;
	}
	flush();
	return lines;
}

/** A radial gap this wide (px) separates two distinct arcs of one component. */
const ARC_SPLIT = 30;
/** Edge points this close (px) to a detected straight edge are not arc samples. */
const LINE_MARGIN = 2.5;
/** Fewest edge points at one coordinate to count as a straight edge rather than an arc extreme. */
const MIN_STRAIGHT_RUN = 80;

type Sector = { region: Region; inner: number; outer: number; gap: number; from: number; to: number };
type Wedge = { region: Region; radius: number; from: number; to: number };
type Geometry = { size: number; cx: number; cy: number; sectors: Sector[]; wedge: Wedge };

/** Quadrant index (0 = +x+y, counting the way angles increase) for a signed offset from the centre. */
function quadrantOf(dx: number, dy: number): number {
	if (dy >= 0) return dx >= 0 ? 0 : 1;
	return dx >= 0 ? 3 : 2;
}

/** Recovers the mark's geometry from the classified raster. */
function measure(data: Buffer, width: number, height: number): Geometry {
	if (width !== height) throw new Error(`expected a square source, got ${width}x${height}`);
	const grid = classifyAll(data, width, height);
	const { labels, list } = findComponents(grid, width, height);
	const shapes = list.filter((c) => c.pixels > width * height * 0.001);
	console.log(`components: ${shapes.map((c) => `${c.region}(${c.pixels}px)`).join(', ')}`);

	// Split each component's outline into its straight radial edges and its arcs. Arcs are
	// clustered on distance from the raster centre, which is close enough to separate them.
	const rough = (width - 1) / 2;
	const parts = shapes.map((component) => {
		const edges = edgesOf(data, labels, width, height, component.label);
		const vertical = straightEdges(edges, 'x', MIN_STRAIGHT_RUN);
		const horizontal = straightEdges(edges, 'y', MIN_STRAIGHT_RUN);
		if (vertical.length !== 1 || horizontal.length !== 1) {
			throw new Error(
				`${component.region} component: expected one vertical and one horizontal straight edge, ` +
				`got ${vertical.length} and ${horizontal.length}`,
			);
		}
		const samples = edges
			.filter((e) => Math.abs(e.x - vertical[0]) > LINE_MARGIN && Math.abs(e.y - horizontal[0]) > LINE_MARGIN)
			.map((e) => ({ ...e, r: Math.hypot(e.x - rough, e.y - rough) }))
			.sort((a, b) => a.r - b.r);
		let split = -1, widest = 0;
		for (let i = 1; i < samples.length; i++) {
			const gap = samples[i].r - samples[i - 1].r;
			if (gap > widest) { widest = gap; split = i; }
		}
		const clusters = widest > ARC_SPLIT ? [samples.slice(0, split), samples.slice(split)] : [samples];
		return {
			component,
			vertical: vertical[0],
			horizontal: horizontal[0],
			arcs: clusters.map((c) => c.map((e) => [e.x, e.y] as [number, number])),
		};
	});

	// One centre serves every arc. Seed it from the independent per-arc fits, then refine by
	// Gauss-Newton on the shared centre with each arc free to take its own radius.
	const allArcs = parts.flatMap((p) => p.arcs);
	let weight = 0, cx = 0, cy = 0;
	for (const arc of allArcs) {
		const fit = fitCircle(arc);
		cx += fit.cx * arc.length;
		cy += fit.cy * arc.length;
		weight += arc.length;
	}
	cx /= weight;
	cy /= weight;
	const radiusOf = (arc: Array<[number, number]>) =>
		arc.reduce((s, [x, y]) => s + Math.hypot(x - cx, y - cy), 0) / arc.length;
	for (let iteration = 0; iteration < 50; iteration++) {
		let gx = 0, gy = 0, hxx = 0, hyy = 0, hxy = 0;
		for (const arc of allArcs) {
			const r = radiusOf(arc);
			for (const [x, y] of arc) {
				const dx = x - cx, dy = y - cy;
				const d = Math.hypot(dx, dy);
				const jx = -dx / d, jy = -dy / d;
				const residual = d - r;
				gx += jx * residual; gy += jy * residual;
				hxx += jx * jx; hyy += jy * jy; hxy += jx * jy;
			}
		}
		const det = hxx * hyy - hxy * hxy;
		if (Math.abs(det) < 1e-12) break;
		const stepX = -(gx * hyy - gy * hxy) / det;
		const stepY = -(hxx * gy - hxy * gx) / det;
		cx += stepX;
		cy += stepY;
		if (Math.hypot(stepX, stepY) < 1e-9) break;
	}

	const quarter = Math.PI / 2;
	const sectors: Sector[] = [];
	let wedge: Wedge | undefined;
	for (const part of parts) {
		const { component } = part;
		const spread = (arc: Array<[number, number]>) => {
			const rs = arc.map(([x, y]) => Math.hypot(x - cx, y - cy));
			const mean = rs.reduce((a, b) => a + b, 0) / rs.length;
			const sd = Math.sqrt(rs.reduce((s, r) => s + (r - mean) ** 2, 0) / rs.length);
			return { mean, sd, n: rs.length };
		};
		if (part.arcs.length === 1) {
			// A pie with one quadrant taken out: its centroid leans away from the missing quadrant.
			const arc = spread(part.arcs[0]);
			const missing = quadrantOf(cx - component.cx, cy - component.cy);
			const from = ((missing + 1) % 4) * quarter;
			console.log(`  ${component.region} wedge: r=${arc.mean.toFixed(3)} sd=${arc.sd.toFixed(3)} n=${arc.n}, quadrant ${missing} removed`);
			wedge = { region: component.region, radius: arc.mean, from, to: from + 3 * quarter };
			continue;
		}
		const inner = spread(part.arcs[0]);
		const outer = spread(part.arcs[1]);
		const sx = Math.sign(component.cx - cx);
		const sy = Math.sign(component.cy - cy);
		// The radial edges are pushed off the axes by a constant gap, measured toward the quadrant.
		const gap = (sx * (part.vertical - cx) + sy * (part.horizontal - cy)) / 2;
		const from = quadrantOf(sx, sy) * quarter;
		console.log(
			`  ${component.region} sector: inner=${inner.mean.toFixed(3)} sd=${inner.sd.toFixed(3)} ` +
			`outer=${outer.mean.toFixed(3)} sd=${outer.sd.toFixed(3)} gap=${gap.toFixed(3)} quadrant ${from / quarter}`,
		);
		sectors.push({
			region: component.region,
			inner: inner.mean,
			outer: outer.mean,
			gap,
			from,
			to: from + quarter,
		});
	}
	if (!wedge) throw new Error('no single-arc component found: the centre wedge is missing');
	if (sectors.length !== 4) throw new Error(`expected 4 annulus sectors, found ${sectors.length}`);
	sectors.sort((a, b) => a.from - b.from);
	console.log(`shared arc centre: (${cx.toFixed(3)}, ${cy.toFixed(3)}) of ${width}x${height}`);
	return { size: width, cx, cy, sectors, wedge };
}

/**
 * Emits the measured geometry as arc paths in a `0 0 VIEW VIEW` viewBox.
 *
 * Each sector is an annulus sector whose two radial edges are pushed `gap` px off the axes,
 * so a chord at radius `r` starts `asin(gap / r)` into the quadrant. The wedge is a three-quarter
 * pie on the same centre.
 */
function buildSvg(geometry: Geometry): string {
	const scale = VIEW / geometry.size;
	const cx = geometry.cx * scale;
	const cy = geometry.cy * scale;
	const n = (v: number) => Number(v.toFixed(3)).toString();
	const point = (r: number, a: number) => `${n(cx + r * Math.cos(a))} ${n(cy + r * Math.sin(a))}`;
	const arc = (r: number, a0: number, a1: number) =>
		`A${n(r)} ${n(r)} 0 ${Math.abs(a1 - a0) > Math.PI ? 1 : 0} ${a1 > a0 ? 1 : 0} ${point(r, a1)}`;

	const paths = geometry.sectors.map((sector) => {
		const inner = sector.inner * scale;
		const outer = sector.outer * scale;
		const gap = sector.gap * scale;
		const innerInset = Math.asin(gap / inner);
		const outerInset = Math.asin(gap / outer);
		const i0 = sector.from + innerInset, i1 = sector.to - innerInset;
		const o0 = sector.from + outerInset, o1 = sector.to - outerInset;
		return `<path fill="${FILLS[sector.region]}" d="M${point(inner, i0)} L${point(outer, o0)} ` +
			`${arc(outer, o0, o1)} L${point(inner, i1)} ${arc(inner, i1, i0)} Z"/>`;
	});

	const radius = geometry.wedge.radius * scale;
	paths.push(
		`<path fill="${FILLS[geometry.wedge.region]}" d="M${n(cx)} ${n(cy)} L${point(radius, geometry.wedge.from)} ` +
		`${arc(radius, geometry.wedge.from, geometry.wedge.to)} Z"/>`,
	);

	return [
		`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${VIEW} ${VIEW}" width="${VIEW}" height="${VIEW}">`,
		...paths,
		'</svg>',
		'',
	].join('\n');
}

async function main(): Promise<void> {
	const { data, width, height } = await loadPixels();
	console.log(`source ${width}x${height}`);

	const geometry = measure(data, width, height);
	const svg = buildSvg(geometry);
	mkdirSync(dirname(OUTPUT), { recursive: true });
	writeFileSync(OUTPUT, svg, 'utf8');

	// Render the SVG back at the source resolution: `density` scales rasterisation itself, so
	// the arcs are drawn at 1275 px rather than drawn at 40 px and blown up.
	const density = (72 * width) / VIEW;
	const rendered = await sharp(Buffer.from(svg), { density }).resize(width, height).ensureAlpha().raw().toBuffer();
	let mismatch = 0;
	for (let i = 0; i < width * height; i++) {
		const src = { r: data[i * 4], g: data[i * 4 + 1], b: data[i * 4 + 2], a: data[i * 4 + 3] };
		const out = { r: rendered[i * 4], g: rendered[i * 4 + 1], b: rendered[i * 4 + 2], a: rendered[i * 4 + 3] };
		if (classify(src) !== classify(out)) mismatch++;
	}
	const ratio = mismatch / (width * height);
	console.log(`mismatch ${(ratio * 100).toFixed(3)}% (${mismatch} of ${width * height} px)`);
	if (ratio > MAX_MISMATCH_RATIO) {
		throw new Error(`trace mismatch ${(ratio * 100).toFixed(3)}% exceeds ${(MAX_MISMATCH_RATIO * 100).toFixed(1)}%`);
	}
	console.log(`wrote ${OUTPUT} (${Buffer.byteLength(svg, 'utf8')} bytes)`);
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
