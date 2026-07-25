import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../shared/settings';

/**
 * The backend hardcodes its own copy of DEFAULT_SETTINGS because Lua cannot import from
 * TypeScript. Drift between the two copies is silent at runtime — the webkit bundle and the
 * backend would simply disagree about what a toggle means. This suite reads the Lua source
 * from disk and proves the two tables are identical, so the duplication stays safe.
 */
// fileURLToPath is given a string, not a URL object: the happy-dom test environment replaces the
// global URL constructor, and Node rejects the resulting foreign instance.
const LUA_SOURCE_PATH = join(dirname(fileURLToPath(import.meta.url)), '..', 'backend', 'main.lua');

/**
 * The assignment statement that opens the table. Anchored to the start of a line with only
 * horizontal whitespace allowed before `local`, so a commented-out copy of the statement
 * (which necessarily begins with `--`) cannot be mistaken for the real one.
 */
const TABLE_ANCHOR = /^[ \t]*local[ \t]+DEFAULT_SETTINGS[ \t]*=[ \t]*\{/gm;

/** A single table entry. Deliberately narrow: bare identifier, `=`, and a boolean literal. */
const ENTRY = /^([A-Za-z_][A-Za-z0-9_]*)[ \t]*=[ \t]*(true|false)$/;

/**
 * Return the text between the table's braces with Lua comments and string literals removed,
 * so that neither can be mistaken for an entry nor end the table early.
 */
function extractTableBody(source: string): string {
	const anchors = [...source.matchAll(TABLE_ANCHOR)];
	if (anchors.length !== 1) {
		throw new Error(`expected exactly one \`local DEFAULT_SETTINGS = {\` statement, found ${anchors.length}`);
	}

	const anchor = anchors[0];
	let index = (anchor.index ?? 0) + anchor[0].length;
	let depth = 1;
	let body = '';

	while (index < source.length) {
		const rest = source.slice(index);

		// Long comment: --[[ ... ]] or --[==[ ... ]==]
		const longComment = /^--\[(=*)\[/.exec(rest);
		if (longComment) {
			const close = `]${longComment[1]}]`;
			const end = source.indexOf(close, index + longComment[0].length);
			if (end === -1) throw new Error('unterminated long comment inside DEFAULT_SETTINGS');
			index = end + close.length;
			continue;
		}

		// Line comment: dropped up to but not including the newline, so entries stay separated.
		if (rest.startsWith('--')) {
			const newline = source.indexOf('\n', index);
			index = newline === -1 ? source.length : newline;
			continue;
		}

		const char = source[index];

		// Quoted string: replaced by a placeholder rather than dropped, so a string-valued
		// entry fails the ENTRY check loudly instead of silently disappearing.
		if (char === '"' || char === "'") {
			index += 1;
			while (index < source.length && source[index] !== char) {
				index += source[index] === '\\' ? 2 : 1;
			}
			if (index >= source.length) throw new Error('unterminated string inside DEFAULT_SETTINGS');
			index += 1;
			body += '<string>';
			continue;
		}

		if (char === '{') depth += 1;
		if (char === '}') {
			depth -= 1;
			if (depth === 0) return body;
		}

		body += char;
		index += 1;
	}

	throw new Error('unterminated DEFAULT_SETTINGS table');
}

/** Split a table body on its top-level separators, ignoring any inside a nested constructor. */
function splitEntries(body: string): string[] {
	const parts: string[] = [];
	let depth = 0;
	let current = '';

	for (const char of body) {
		if (char === '{' || char === '(') depth += 1;
		else if (char === '}' || char === ')') depth -= 1;

		if ((char === ',' || char === ';') && depth === 0) {
			parts.push(current);
			current = '';
			continue;
		}

		current += char;
	}

	parts.push(current);
	return parts;
}

/**
 * Parse `DEFAULT_SETTINGS` out of Lua source. Throws rather than skipping on anything it does
 * not understand, so an unrecognised entry can never be silently omitted from the comparison.
 */
function parseLuaDefaults(source: string): Record<string, boolean> {
	const parsed: Record<string, boolean> = {};

	for (const raw of splitEntries(extractTableBody(source))) {
		const fragment = raw.trim();
		if (fragment === '') continue;

		const match = ENTRY.exec(fragment);
		if (!match) {
			throw new Error(`DEFAULT_SETTINGS entry is not a plain boolean assignment: ${JSON.stringify(fragment)}`);
		}

		const [, key, value] = match;
		if (Object.prototype.hasOwnProperty.call(parsed, key)) {
			throw new Error(`duplicate key in DEFAULT_SETTINGS: ${key}`);
		}
		parsed[key] = value === 'true';
	}

	if (Object.keys(parsed).length === 0) {
		throw new Error('parsed no entries out of DEFAULT_SETTINGS');
	}
	return parsed;
}

function luaDefaults(): Record<string, boolean> {
	return parseLuaDefaults(readFileSync(LUA_SOURCE_PATH, 'utf8'));
}

describe("backend/main.lua's DEFAULT_SETTINGS", () => {
	it('declares exactly the keys shared/settings.ts declares', () => {
		const lua = Object.keys(luaDefaults()).sort();
		const ts = Object.keys(DEFAULT_SETTINGS).sort();

		// Both directions: a key added to either side alone has to fail here.
		expect(lua.filter((key) => !ts.includes(key))).toEqual([]);
		expect(ts.filter((key) => !lua.includes(key))).toEqual([]);
		expect(lua).toEqual(ts);
	});

	it('declares the same value as shared/settings.ts for every key', () => {
		expect(luaDefaults()).toEqual({ ...DEFAULT_SETTINGS });
	});
});

/**
 * The comparison above is only as trustworthy as the parser feeding it. These cases use neutral
 * key names so the real defaults are never restated outside their two sources.
 */
describe('parseLuaDefaults', () => {
	it('ignores a line comment that looks like an entry', () => {
		expect(
			parseLuaDefaults(['-- alpha = true', 'local DEFAULT_SETTINGS = {', '    -- alpha = true', '    alpha = false,', '}'].join('\n')),
		).toEqual({ alpha: false });
	});

	it('ignores a long comment that looks like an entry', () => {
		expect(parseLuaDefaults('local DEFAULT_SETTINGS = {\n--[==[ alpha = true, ]==]\nalpha = false,\n}')).toEqual({ alpha: false });
	});

	it('does not treat a commented-out assignment as the table', () => {
		expect(() => parseLuaDefaults('-- local DEFAULT_SETTINGS = {\n--     alpha = true,\n-- }\n')).toThrow(
			/found 0/,
		);
	});

	it('refuses to guess when a second assignment could shadow the first', () => {
		expect(() =>
			parseLuaDefaults('local DEFAULT_SETTINGS = {\nalpha = true,\n}\nlocal DEFAULT_SETTINGS = {\nalpha = false,\n}\n'),
		).toThrow(/found 2/);
	});

	it('throws instead of skipping an entry it cannot read', () => {
		expect(() => parseLuaDefaults('local DEFAULT_SETTINGS = {\nalpha = true,\nbeta = compute(),\n}')).toThrow(
			/not a plain boolean assignment/,
		);
		expect(() => parseLuaDefaults('local DEFAULT_SETTINGS = {\n["alpha"] = true,\n}')).toThrow(
			/not a plain boolean assignment/,
		);
		expect(() => parseLuaDefaults('local DEFAULT_SETTINGS = {\nalpha = "true",\n}')).toThrow(
			/not a plain boolean assignment/,
		);
	});

	it('throws on a duplicate key rather than letting the last one win', () => {
		expect(() => parseLuaDefaults('local DEFAULT_SETTINGS = {\nalpha = true,\nalpha = false,\n}')).toThrow(
			/duplicate key/,
		);
	});

	it('throws when the table is missing or empty', () => {
		expect(() => parseLuaDefaults('local OTHER = { alpha = true }\n')).toThrow(/found 0/);
		expect(() => parseLuaDefaults('local DEFAULT_SETTINGS = {\n}\n')).toThrow(/parsed no entries/);
	});

	it('is indifferent to layout, separators, and a missing trailing comma', () => {
		expect(parseLuaDefaults('\tlocal DEFAULT_SETTINGS   =  { alpha = true; beta = false }\n')).toEqual({
			alpha: true,
			beta: false,
		});
	});
});
