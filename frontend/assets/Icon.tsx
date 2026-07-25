/**
 * The CS2Tracker mark, transcribed from assets/icon.svg into JSX. Regenerate that asset with
 * `pnpm run trace-icon`, then re-transcribe it here. Copy the numbers rather than retyping them --
 * they are traced output measured off the published raster, not hand-authored coordinates.
 *
 * The viewBox is geometry, not packaging. The mark's arcs share an off-centre origin at
 * (22.62, 22.62) of this 0 0 40 40 box, so re-cropping it to something centred or square visibly
 * shifts every arc. Copy the box and all five shapes verbatim or not at all, and keep them in this
 * order: document order is paint order, and two of them share each of two of the three fills, so a
 * reordering is not merely cosmetic.
 *
 * Sized in em, which is the one deliberate difference from the asset -- that file carries
 * width="40" height="40" for standalone use, and this component instead inherits whatever text size
 * the surrounding Steam component gives it, so it lines up with adjacent label text at any scale.
 *
 * flexShrink is not decoration. Every mount point is a flex row of Steam's own making, and a flex item
 * with an em-relative size is compressible: a tight row squashes the box below its own width and the
 * mark distorts rather than overflowing. webkit/styles.ts:46 pins `flex:0 0 auto` on the same mark for
 * the same reason.
 *
 * Only `fill` and `d` appear here because they are the only attributes the trace emits, and React
 * spells both exactly as SVG does. If a future trace ever emits fill-rule, clip-rule, or stroke-width,
 * transcribe them as fillRule, clipRule, and strokeWidth. React 16 and later do forward a hyphenated
 * attribute to the DOM, so the mark would still draw, but each one logs a development warning naming
 * the camelCase spelling, and Steam's console is not this plugin's to fill. The failure that actually
 * loses geometry is the plainer one -- an attribute the asset carries and this transcription does not --
 * and tests/frontend-icon.test.ts fails on any element or attribute the asset grows that this file does
 * not know about, so neither can pass unnoticed.
 */
export const CS2TrackerIcon = () => (
	<svg
		xmlns="http://www.w3.org/2000/svg"
		viewBox="0 0 40 40"
		style={{ flexShrink: 0, height: '1em', width: '1em' }}
		aria-hidden="true"
	>
		<path
			fill="#7f8181"
			d="M32.992 24.345 L39.966 24.345 A17.432 17.432 0 0 1 24.345 39.966 L24.345 32.992 A10.515 10.515 0 0 0 32.992 24.345 Z"
		/>
		<path
			fill="#ffffff"
			d="M20.894 32.992 L20.894 39.966 A17.432 17.432 0 0 1 5.273 24.345 L12.247 24.345 A10.515 10.515 0 0 0 20.894 32.992 Z"
		/>
		<path
			fill="#007aef"
			d="M12.104 22.62 L0.006 22.62 A22.614 22.614 0 0 1 22.62 0.006 L22.62 12.104 A10.516 10.516 0 0 0 12.104 22.62 Z"
		/>
		<path
			fill="#ffffff"
			d="M24.345 12.247 L24.345 5.273 A17.432 17.432 0 0 1 39.966 20.894 L32.992 20.894 A10.515 10.515 0 0 0 24.345 12.247 Z"
		/>
		<path fill="#007aef" d="M22.62 22.62 L22.62 17.436 A5.184 5.184 0 1 1 17.436 22.62 Z" />
	</svg>
);
