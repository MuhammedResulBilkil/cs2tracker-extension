import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The contract between every `callable(...)` binding in TypeScript and the Lua function it names.
 *
 * Nothing else checks it. The two sides are separate languages joined by a string, and each of the
 * three ways that join can be wrong fails silently at runtime:
 *
 *   - A Lua function declared `local` is invisible to Millennium, which resolves an RPC by global
 *     name. The call rejects with "function not found" from inside an IPC layer, and both existing
 *     RPCs carry a comment saying so because it has already happened once here.
 *   - Millennium's `callable` forwards `arguments[0]` and discards the rest, so a binding declared
 *     with two positional parameters loses the second one. The backend then sees nil for it, and a
 *     function that validates its input answers "refused" for every call -- a feature that does
 *     nothing, with no error anywhere the user can see.
 *   - The keys of that one object argument become the backend function's named parameters. A key
 *     that does not match a parameter name arrives as nil, which is the same silent failure.
 *
 * All three are statically decidable, which is the only reason this file can exist: neither bundle
 * can be imported by a test -- @steambrew/client and @steambrew/webkit both resolve to globals only
 * the Steam client defines -- so the sources are read from disk as text, the way
 * tests/settings-sync.test.ts reads DEFAULT_SETTINGS out of the same Lua file.
 *
 * Every parser below throws rather than skipping on anything it does not recognise. A regex that
 * quietly matches nothing is the failure mode that matters here: it would report a clean run over
 * zero RPCs.
 */
// fileURLToPath is given a string, not a URL object: the happy-dom test environment replaces the
// global URL constructor, and Node rejects the resulting foreign instance.
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const LUA_SOURCE_PATH = join(REPO_ROOT, 'backend', 'main.lua');

/** The bundles that may hold an RPC binding. `shared` cannot: it imports nothing from Steam. */
const BUNDLE_DIRS = ['frontend', 'webkit'];

interface RpcBinding {
	/** The Lua function name, as written in the `callable('...')` call. */
	name: string;
	/** Repo-relative file and 1-based line, so a failure message points at the call site. */
	site: string;
	/**
	 * The declared argument tuple's raw text, without the brackets. Empty for `callable<[], T>`.
	 * Kept as text because what is being checked is the shape of the declaration itself.
	 */
	args: string;
}

/** Every `.ts`/`.tsx` file under a directory, recursively. */
function sourceFiles(dir: string): string[] {
	const found: string[] = [];
	for (const entry of readdirSync(dir)) {
		const path = join(dir, entry);
		if (statSync(path).isDirectory()) {
			found.push(...sourceFiles(path));
			continue;
		}
		if (/\.tsx?$/.test(entry)) found.push(path);
	}
	return found;
}

/**
 * A binding: `callable<[...], Return>('Name')`.
 *
 * The type arguments are required by this pattern, and deliberately so. A call written
 * `callable('Name')` would infer its argument tuple and defeat the shape checks below, so it is
 * treated as unrecognised rather than matched loosely -- see the `callable` sweep test.
 */
const BINDING = /\bcallable\s*<\s*\[([^\]]*)\]\s*,[^>]*>\s*\(\s*'([A-Za-z_]\w*)'\s*\)/g;

/** Any mention of `callable` as a called or bound value, used to prove BINDING missed nothing. */
const CALLABLE_USE = /\bcallable\s*[<(]/g;

function bindings(): RpcBinding[] {
	const found: RpcBinding[] = [];

	for (const dir of BUNDLE_DIRS) {
		for (const path of sourceFiles(join(REPO_ROOT, dir))) {
			const source = readFileSync(path, 'utf8');
			const relative = path.slice(REPO_ROOT.length + 1).replace(/\\/g, '/');

			for (const match of source.matchAll(BINDING)) {
				const line = source.slice(0, match.index ?? 0).split('\n').length;
				found.push({ name: match[2], args: match[1].trim(), site: `${relative}:${line}` });
			}
		}
	}

	return found;
}

/**
 * Top-level `function Name(a, b)` declarations, with their parameter lists.
 *
 * Anchored to the start of a line with nothing but the keyword before the name, which is what makes
 * this a test of global-ness rather than of existence: `local function Name(` does not match, and
 * neither does an indented declaration nested inside another function.
 */
const LUA_GLOBAL_FUNCTION = /^function[ \t]+([A-Za-z_]\w*)[ \t]*\(([^)]*)\)/gm;

function luaGlobalFunctions(source: string): Map<string, string[]> {
	const found = new Map<string, string[]>();

	for (const match of source.matchAll(LUA_GLOBAL_FUNCTION)) {
		const params = match[2]
			.split(',')
			.map((param) => param.trim())
			.filter((param) => param !== '');
		found.set(match[1], params);
	}

	return found;
}

/**
 * The names the module's return table exposes, from entries of the form `Name = Name`.
 *
 * Millennium calls a plugin's lifecycle hooks through this table, and it is also how a reader learns
 * what the backend offers. An RPC missing from it still works, so this is a consistency check rather
 * than a correctness one -- but a global function nobody declared here is one nobody knows about.
 */
function luaReturnTableNames(source: string): string[] {
	const table = /return[ \t]*\{([\s\S]*?)\}/.exec(source);
	if (!table) throw new Error('backend/main.lua has no `return { ... }` table');

	return [...table[1].matchAll(/^[ \t]*([A-Za-z_]\w*)[ \t]*=/gm)].map((match) => match[1]);
}

const lua = readFileSync(LUA_SOURCE_PATH, 'utf8');
const luaFunctions = luaGlobalFunctions(lua);
const rpcs = bindings();

describe('RPC bindings', () => {
	/**
	 * The guard on every assertion below, because all of them iterate `rpcs`. A regex that stopped
	 * matching -- a rename, a formatting change, a prettier pass that broke the call across lines --
	 * would empty that array and turn every `it.each` into a passing no-op. Pinned to the exact
	 * names rather than a count, so a binding cannot be dropped and replaced by a new one unnoticed.
	 */
	it('finds every RPC the bundles bind', () => {
		expect([...new Set(rpcs.map((rpc) => rpc.name))].sort()).toEqual([
			'GetSettings',
			'ResolveVanity',
			'SetSetting',
		]);
	});

	/**
	 * Nothing mentions `callable` that the binding pattern did not parse.
	 *
	 * Without this, the pattern above is only a lower bound: a fourth RPC written in a shape it does
	 * not recognise -- no type arguments, a double-quoted name, a name built from a constant -- would
	 * be exempt from every check in this file rather than caught by one. Import statements and prose
	 * are excluded by counting only `callable<` and `callable(`.
	 */
	it('parses every use of callable it can see', () => {
		const unparsed: string[] = [];

		for (const dir of BUNDLE_DIRS) {
			for (const path of sourceFiles(join(REPO_ROOT, dir))) {
				const source = readFileSync(path, 'utf8');
				// Comments mention `callable(...)` when explaining the transform, so they are stripped
				// before counting. Both forms, since these files use each.
				const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
				const uses = [...code.matchAll(CALLABLE_USE)].length;
				const parsed = [...code.matchAll(BINDING)].length;
				if (uses !== parsed) {
					unparsed.push(`${path.slice(REPO_ROOT.length + 1)}: ${uses} use(s), ${parsed} parsed`);
				}
			}
		}

		expect(unparsed).toEqual([]);
	});

	it.each(rpcs)('$name is a global Lua function ($site)', ({ name }) => {
		// The message names the failure rather than showing `undefined`, because the fix -- delete the
		// word `local` -- is not obvious from a missing-key assertion.
		expect(luaFunctions.has(name), `backend/main.lua declares no top-level \`function ${name}(\``).toBe(
			true,
		);
	});

	it.each(rpcs)('$name is listed in the return table ($site)', ({ name }) => {
		expect(luaReturnTableNames(lua)).toContain(name);
	});

	/**
	 * At most one declared argument, because Millennium forwards only the first.
	 *
	 * A tuple of two is the shape that reads correctly, compiles, and drops half the call.
	 */
	it.each(rpcs)('$name declares at most one argument ($site)', ({ args }) => {
		if (args === '') return;
		expect(splitTopLevel(args)).toHaveLength(1);
	});

	/**
	 * That one argument is an object type, and its keys are exactly the Lua function's parameters.
	 *
	 * This is the check that ties the two languages together: the object's keys arrive as the
	 * backend's named parameters, so a key that does not match a parameter name is nil on arrival.
	 * A backend function that takes no parameters must be bound with no argument at all, which is
	 * the `GetSettings` case.
	 */
	it.each(rpcs)("$name's argument keys match its Lua parameters ($site)", ({ name, args }) => {
		const params = luaFunctions.get(name);
		if (!params) return; // Already failed, loudly, in the global-function case above.

		if (args === '') {
			expect(params, `${name} takes parameters, so its binding must pass an object`).toEqual([]);
			return;
		}

		const object = /^\{([\s\S]*)\}$/.exec(splitTopLevel(args)[0].replace(/^\w+\s*:\s*/, '').trim());
		expect(object, `${name}'s single argument must be an object type, so its keys can name parameters`).not.toBeNull();

		const keys = splitTopLevel(object?.[1] ?? '')
			.map((member) => /^([A-Za-z_]\w*)\s*:/.exec(member.trim())?.[1])
			.filter((key): key is string => key !== undefined);

		expect(keys.slice().sort()).toEqual(params.slice().sort());
	});
});

/**
 * Split a type-argument or member list on its top-level separators.
 *
 * Depth-aware over brackets, braces and parens so that a nested object or tuple cannot be mistaken
 * for two entries. Accepts `,` and `;` because an object type literal may use either.
 */
function splitTopLevel(text: string): string[] {
	const parts: string[] = [];
	let depth = 0;
	let current = '';

	for (const char of text) {
		if (char === '{' || char === '[' || char === '(') depth += 1;
		else if (char === '}' || char === ']' || char === ')') depth -= 1;

		if ((char === ',' || char === ';') && depth === 0) {
			if (current.trim() !== '') parts.push(current);
			current = '';
			continue;
		}

		current += char;
	}

	if (current.trim() !== '') parts.push(current);
	return parts;
}
