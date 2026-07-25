import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Guards the module names `backend/main.lua` requires.
 *
 * A `require` of a module Millennium does not preload is fatal and silent from the outside: the Lua
 * backend exits before it opens its IPC socket, so Steam reports only an exit code, no plugin log
 * survives, and nothing distinguishes it from a syntax error or a crash in on_load.
 *
 * That is not hypothetical. The backend originally required `cjson`, which is documented on
 * Millennium's own docs site and has a `---@meta` type stub in the official PluginTemplate -- but is
 * not preloaded by Millennium v3.3.1, the current stable release. The plugin died on load with exit
 * code 1 and no diagnostic.
 *
 * The allowlist below is empirical, not documentary, because the documentation is what got this
 * wrong. Every name in it was observed being required by a plugin installed and running under
 * v3.3.1 whose IPC socket existed (proving its requires resolved):
 *
 *   logger, millennium  -- alowave.faceit_stats, csstats-extension, leetify-extension, hltb-for-millennium
 *   http, json, fs, utils -- alowave.faceit_stats
 *
 * `cjson` is deliberately absent. A type stub proves what an editor believes, never what the runtime
 * provides. If a later Millennium adds a module, add it here with the evidence that it resolves.
 */
const AVAILABLE_MODULES = ['logger', 'millennium', 'http', 'json', 'fs', 'utils'] as const;

/** Modules a stub or the docs may tempt you into, that v3.3.1 does not preload. */
const KNOWN_ABSENT = ['cjson'] as const;

const REQUIRE_PATTERN = /require\s*\(\s*["']([^"']+)["']\s*\)/g;

function requiredModules(): string[] {
	const source = readFileSync(join(process.cwd(), 'backend', 'main.lua'), 'utf8');
	const withoutComments = source.replace(/--\[\[[\s\S]*?]]/g, '').replace(/--[^\n]*/g, '');
	return [...new Set([...withoutComments.matchAll(REQUIRE_PATTERN)].map((match) => match[1]))].sort();
}

describe('backend/main.lua module requires', () => {
	it('requires at least one module, so a broken parse cannot pass vacuously', () => {
		expect(requiredModules().length).toBeGreaterThan(0);
	});

	it('requires only modules Millennium preloads', () => {
		const unavailable = requiredModules().filter((name) => !AVAILABLE_MODULES.includes(name as never));
		expect(unavailable).toEqual([]);
	});

	it.each(KNOWN_ABSENT)('does not require %s, which v3.3.1 does not provide', (name) => {
		expect(requiredModules()).not.toContain(name);
	});

	it('ignores a require that appears only inside a comment', () => {
		const source = readFileSync(join(process.cwd(), 'backend', 'main.lua'), 'utf8');
		expect(source).not.toMatch(/^\s*--.*require\s*\(\s*["']cjson/m);
	});
});
