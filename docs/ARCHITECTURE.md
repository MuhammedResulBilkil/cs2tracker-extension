# Architecture

Design notes for CS2Tracker Extension. This file records the constraints that are expensive to
rediscover — the ones that are invisible in the code, or that look like arbitrary style until the
failure they prevent actually happens.

Every rule below is stated with its consequence. A rule without its failure mode reads as clutter and
gets tidied away by the next person who touches the file.

## Contents

- [The three runtimes](#the-three-runtimes)
- [Repository layout](#repository-layout)
- [Why `shared/` works](#why-shared-works)
- [Toolchain](#toolchain)
- [Traps](#traps)
- [Design decisions](#design-decisions)
- [Store review rules the code is shaped by](#store-review-rules-the-code-is-shaped-by)
- [Phase 2, and why it was deferred](#phase-2-and-why-it-was-deferred)
- [Verification](#verification)

## The three runtimes

A Millennium plugin is not one program. It is three, in three different processes, with three
different sets of capabilities. Most of the surprises in this codebase come from code written for one
of them being reasoned about as if it were in another.

| | Lua backend | Frontend | Webkit |
|---|---|---|---|
| Entry point | `backend/main.lua` | `frontend/index.tsx` | `webkit/index.tsx` |
| Runtime | LuaJIT, native, in the Millennium host | Steam's UI process | Steam's embedded browser (CEF) |
| Package | `require("millennium")` and friends | `@steambrew/client` | `@steambrew/webkit` |
| Has React | no | yes | **no** |
| Has a DOM | no | yes (Steam's UI tree) | yes (the web page) |
| Can make arbitrary HTTP requests | yes, `require("http")` | — | same-origin `fetch` on the page |
| Owns persistent config | **yes** | reads/writes via config API | reads over RPC |

**Lua backend.** Runs once per Steam session, outside any browser. It is the only runtime that can
persist configuration and the only one that can reach an arbitrary host without a page's origin rules
in the way. It exposes RPC functions the other two call. It has no DOM and no React; nothing here can
render anything.

**Frontend.** Runs inside the Steam client's own UI process, the one that draws the library, the
store tab and the settings dialogs. React is present because Steam itself uses it, and Steam's
component library (`ToggleField`, `TextField`, `DialogButton`, `Spinner`, …) is importable from
`@steambrew/client`. This is where the settings panel lives, and it is the *only* place this plugin
renders React. It cannot see the pages the community browser has open.

**Webkit.** Runs inside every web page the Steam client opens — the community browser, the store tab,
the news pages. **There is no React here.** It is a plain DOM environment, so injection is
`createElement`/`appendChild` and nothing more. This bundle re-runs per document, so "already done"
has to be answered by inspecting the document, never by a module-level flag: a module-level flag
looks idempotent and leaves every page after the first one unstyled and un-injected.

The webkit bundle also runs on pages this plugin has no business touching, which is why
`webkit/index.tsx` gates on `isSteamCommunityHost(location.hostname)` before it does anything at all,
including before the settings IPC call. On `store.steampowered.com` the correct amount of work is
none.

## Repository layout

```
backend/main.lua          the Lua backend; RPC functions and config defaults
backend/types/*.lua       LuaLS `---@meta` stubs so an editor can resolve require("millennium")
frontend/                 the settings panel, React, Steam's components
webkit/                   page injection, plain DOM
shared/                   pure modules imported by both TS bundles
tests/                    vitest, happy-dom; covers shared/ and the decidable parts of frontend/
                          and webkit/, plus a drift check between the Lua and TS defaults
scripts/                  build-time tooling (release packaging, version sync, image generation)
plugin.json               the manifest Millennium and the store read
.millennium/Dist/         build output: index.js (frontend) and webkit.js (webkit)
```

`backend/types/` holds five stub files that exist purely for editor resolution. Lua's `package.path`
never looks inside a `types/` subdirectory, so nothing at runtime can read them. The release
packaging script drops them from the downloadable zip, where they are otherwise about a third of the
archive.

## Why `shared/` works

`@steambrew/ttc` builds each bundle with rollup, so a cross-directory relative import — `webkit/`
importing `../shared/steamid` — is resolved and inlined into that bundle's output. There is no path
alias, no `tsconfig` `paths` entry and no package boundary involved; the module simply gets bundled
into both `index.js` and `webkit.js`.

This is load-bearing enough that it was proved with a build gate before any code depended on it,
rather than assumed from the toolchain's documentation. If a future toolchain change breaks it, the
symptom is a build failure rather than a runtime one, which is the good case — but it would break
every module in `shared/` at once.

The practical rule that follows: **`shared/` must import nothing.** Not `@steambrew/client`, not
`@steambrew/webkit`, not Node builtins. Both of the Steam packages resolve to globals that exist only
inside the Steam client, so a `shared/` module that touched either would become unloadable in the
test runner and would drag the bundle it was pulled into out of the runtime it was written for. The
same constraint is what makes `shared/` the place where the decidable logic lives and therefore the
place the test suite can actually reach.

## Toolchain

### The legacy toolchain is deliberate, not stale

This plugin uses the legacy Millennium toolchain: a `plugin.json` manifest built by `@steambrew/ttc`.
It does **not** use starlight (`millennium.toml`). That is a decision, and it will look like an
oversight to anyone who reads Millennium's newer documentation first.

The reasons, in order of how hard they are to work around:

1. **The store's own CI requires it.** The plugin database's `prepare-dist.sh` clones the repository,
   runs `pnpm install && pnpm run build`, and then expects a `.millennium` directory and a
   `plugin.json`. A repository that ships only a `millennium.toml` produces neither, and the failure
   is a store-side build failure that no amount of local testing would catch.
2. **Every plugin in the database uses it.** All 24 plugins in the store at the time of writing ship
   `plugin.json`. Being the first to ship something else means being the first to discover what the
   review pipeline does with it.
3. **Starlight support is not released.** It exists on an unmerged branch of the official plugin
   template (`starlight-v2-support` on `PluginTemplate`), not on its default branch.

### Migration triggers

Migrate when — and not before — any one of these is true:

- `PluginTemplate` merges `starlight-v2-support` into its default branch.
- The plugin database's `prepare-dist.sh` learns to read `millennium.toml`.
- Any plugin in the store ships a `millennium.toml` and is accepted.

Until one of those happens, migrating means leaving the only distribution path this plugin has.

### `pnpm-lock.yaml`, not `bun.lock`

The store's CI runs `pnpm install`. A `bun.lock` would be ignored by it, so the versions the store
builds against would be resolved fresh from the registry rather than pinned — which makes the store's
build a different build from the one that was tested here, silently, and only on the days a
transitive dependency ships a breaking patch. `pnpm-lock.yaml` is committed and is the source of
truth. `bun.lock` is gitignored so it cannot be committed by accident.

Use `pnpm`. Not npm, not bun.

### `pnpm-workspace.yaml` is not a workspace

This repository is not a monorepo, and the file's presence is confusing on purpose-built grounds:

- It exists **solely to approve build scripts**. pnpm 11 refuses to run ignored build scripts and
  exits `ERR_PNPM_IGNORED_BUILDS` with a non-zero status, which fails the freshness check that runs
  before every `pnpm run` script — so the whole toolchain stops working, not just the install.
- It carries **both spellings**, `onlyBuiltDependencies` and `allowBuilds`, because `allowBuilds` was
  introduced later and backported into only some pnpm 10 releases. Removing either one narrows the
  range of pnpm versions that can install this repository.
- It needs `packages: []`. pnpm 10.0 through 10.4 treat the mere presence of a
  `pnpm-workspace.yaml` as a workspace declaration and refuse to install without a `packages` field.
  An empty array is the "not a workspace" answer.

None of the approved scripts are needed for correct output — `@esbuild/win32-x64` supplies its binary
as an optional dependency either way. The file exists to keep the exit code at zero.

## Traps

These six have all cost real time. Each of them fails silently.

### The JSON module is `json`, and a type stub is not evidence

`require("cjson")` kills the backend. Millennium v3.3.1 preloads the JSON module as **`json`**.

This is worth understanding rather than just obeying, because the mistake was reasonable. `cjson` has
its own page on Millennium's documentation site, and the official `PluginTemplate` ships
`backend/types/cjson.lua` as a `---@meta` stub. Both were treated as proof the runtime provides it.
Neither is: the docs run ahead of the current stable release, and a `---@meta` file is a declaration
for the language server that asserts nothing about what is loaded at runtime. The template's own
`main.lua` never requires it.

The failure is about as opaque as this codebase gets. A `require` of a missing module raises during
module load — before `on_load`, before `millennium.ready()`, before the backend opens its IPC socket.
So there is no plugin log to read, no Lua traceback surfaced anywhere, and no socket under
`%LOCALAPPDATA%\Temp\millennium-plugin-*`. Steam shows a crash dialog with exit code `0x00000001` and
nothing else. It is indistinguishable from a syntax error or a crash inside `on_load`.

What settled it was comparing against installed plugins that work. `alowave.faceit_stats` requires
`logger`, `millennium`, `http`, `json`, `fs`, `utils`, ships no `json.lua` of its own, and has a live
socket — so `json` is preloaded. No installed plugin requires `cjson`, and no file named `cjson`
exists anywhere in the Millennium install.

`tests/backend-modules.test.ts` now guards this: it parses `backend/main.lua` and fails if it requires
anything outside an allowlist built from modules **observed resolving** on a running v3.3.1, rather
than from documentation. `backend/types/json.lua` was rewritten to declare only `encode` and `decode`
for the same reason — a stub that promises more than the runtime provides will autocomplete you into a
crash that reports nothing.

### Lua RPC functions must be global

Millennium resolves `callable('GetSettings')` by looking up a **global** function of that name. It
does not read the table the module returns.

```lua
function GetSettings() ... end        -- correct
local function GetSettings() ... end  -- fails at runtime: "function not found"
```

Listing the function in the return table is not enough and is not what makes it callable; it is kept
there only so the module's public surface is readable in one place. Declaring it `local` — which is
what a Lua reviewer will suggest, because everything else in the file is `local` — breaks every call
from both TypeScript bundles, at runtime, with no build-time signal.

### `plugin.json` must declare `"webkitApiVersion": "2.0.0"`

Without it, Millennium never loads `webkit.js`. Nothing errors. The frontend panel appears and works,
the toggles persist, and no button is ever injected into any page — which reads exactly like a
selector bug and sends you looking in `webkit/inject-profile.ts` for a fault that is in the manifest.

### `usePluginConfig` and `callable` must stay literal, in-place calls

`@steambrew/ttc` rewrites both call sites at build time to inject the plugin name as a hidden first
argument. The built output is `usePluginConfig(pluginName, key)` and `callable(pluginName, "GetSettings")`.

The rewrite matches on the **callee's literal member path**. So all of these lose it:

```ts
const cfg = usePluginConfig;        // aliased
const { callable: rpc } = pkg;      // destructured
function read(hook) { hook(key); }  // passed along
const wrapped = (k) => usePluginConfig(k);  // wrapped — the inner call is fine, the outer is not
```

Nothing throws when the injection vanishes. The arguments shift by one, so `key` lands in the
plugin-name position and every read and write silently targets *a plugin named after the setting*.
The user's toggles appear to work and never persist. This is why `frontend/services/settings.ts` is
the only module in the frontend bundle that touches the config API, `webkit/settings.ts` the only one
in the webkit bundle that binds an RPC, and why neither of them decides anything: the decidable logic
is in `shared/` and `frontend/services/setting-value.ts` where it can be tested, and these two files
hold nothing but the literal call and its wiring.

### `Plugin.title` is required at runtime, and the published type omits it

`@steambrew/client` declares `Plugin` with `version`, `icon`, `content`, `onDismount`, `alwaysRender`
and `titleView` — and not `title`. Removing `title` to satisfy the type ships a plugin with no
settings panel.

The generated wrapper `@steambrew/ttc` emits guards on

```
pluginProps.title !== undefined && pluginProps.icon !== undefined && pluginProps.content !== undefined
```

before assigning to `window.MILLENNIUM_SIDEBAR_NAVIGATION_PANELS[pluginName]`. All three are required
at runtime, and the published type agrees about exactly one of them: `icon` is required, `content` is
optional, and `title` is absent from the interface altogether. A missing one is not an error anywhere
— the panel just never appears in the sidebar.

`frontend/index.tsx` handles this with a local `SidebarPlugin extends Plugin` interface that adds
`title: string` and `content: JSX.Element`. The interface, rather than an inline object literal, is
also what restores TypeScript's excess-property checking: `definePlugin`'s callback returns the union
`Plugin | Promise<Plugin>`, and object-literal freshness checks do not fire against a union, so
without the annotation a misspelt `content` compiles cleanly and produces a panel that silently fails
to register.

`plugin.json`'s `common_name` is a different string with a different job — it names the plugin in
Millennium's plugin list, while `title` names the sidebar page. They are kept identical on purpose,
and neither can substitute for the other.

### Never read `window.g_steamID`

`g_steamID` is the **signed-in user's** SteamID, not the profile currently on screen. Using it makes
every profile link point at the viewer.

This is the worst kind of bug because it hides: your own profile page still looks perfectly correct,
so it passes the obvious test, and every *other* profile silently links to your stats. The correct
per-page source is `g_rgProfileData`, and the full resolution order is below.

## Design decisions

### SteamID resolution order

`webkit/steamid.ts` resolves the viewed profile's SteamID64 from four sources, most authoritative
first. Every branch is range-checked, so a non-null result is always a well-formed SteamID64 in the
individual-account interval.

1. **The `/profiles/<id>/` URL.** What the browser is actually showing. No network, and nothing on
   the page can spoof it.
2. **`window.g_rgProfileData`.** Steam populates this per page with the *viewed* profile's data. A
   non-string candidate is skipped rather than coerced: `76561198145891996` exceeds 2^53, where the
   spacing between representable doubles is 16, so a numeric id would stringify to
   `76561198145892000` — a well-formed SteamID64 belonging to somebody else.
3. **A profile-root gate**, then the page's `?xml=1` view. On a profile's own root this cannot name
   anybody but the page owner, which is what makes it authoritative enough to outrank the scrape
   below. It costs a round trip.
4. **`data-miniprofile`.** A DOM scrape, and **deliberately last**.

The gate before 3 and 4 matters because those two read whatever the page happens to contain, so they
must run only once the document is known to be one profile's own root. Off a profile root the answer
is `null`: there is no viewed profile to resolve, and `null` is honest where a guess would be
silently wrong.

**Why the scrape is last.** `document.querySelector('[data-miniprofile]')` takes the first match in
the whole document, and that attribute also decorates friend-list, comment-thread and group-member
avatars — other people. If Steam's community header avatar carries it, the first match is the
signed-in viewer, which is the `g_steamID` failure arrived at from the other direction: it would hide
the same way. Every branch above it is either spoof-proof or names only the page owner, so this one
runs only when all of them have missed.

**Why it is still there.** It cannot be shown unnecessary without a live Steam client. The reference
plugins carry it and none of them document why, so deleting it on reasoning alone would discard a
fallback that may cover a real case. It is demoted, not removed, and can be settled empirically
against a running client.

### The settings model

Three actors, one owner:

- **The backend owns storage.** `backend/main.lua` writes the defaults through Millennium's config
  API on load and exposes `GetSettings()` as the read path. `DEFAULT_SETTINGS` there must stay in
  sync with `DEFAULT_SETTINGS` in `shared/settings.ts`; nothing enforces that, and a drift shows up
  as a feature that is off by default in one runtime and on in the other.
- **The frontend reads reactively** through `usePluginConfig`, keyed per setting. Reactive is what
  makes it a two-line hook rather than a store: a change made by the panel, by the backend, or by
  another mounted consumer re-renders every consumer of that key, so two controls bound to the same
  setting cannot drift. Keyed per setting rather than whole-config because the no-argument overload
  returns `Record<string, any>`, which would put an untyped key at every call site.
- **The webkit bundle reads over RPC**, because **`@steambrew/webkit` does not export
  `pluginConfig`**. That is the whole reason `GetSettings` exists as an RPC function at all. It is not
  a design preference and it is not redundant with the frontend's path.

The webkit bundle reads settings **once, at page load**, and does not watch for changes. So a toggle
flipped now applies to the next page, not to the ones already open. This is surfaced in the UI
(`REOPEN_HINT` on every toggle) and in the README, because the difference between saying so and not
saying so is the difference between a working plugin and one that looks broken for as long as the
user leaves a stale tab in front of them.

Payload decoding is `parseSettings` in `shared/settings.ts`, and it is documented total: every
malformed input answers with a fresh copy of the defaults, and nothing there throws or writes to the
console. It takes `unknown` rather than `string` on purpose — `callable<Args, T>` casts a free type
parameter straight onto `Promise<T>` with nothing validating it, so declaring the return as `string`
would be an assertion dressed as a type.

### Network surface

The README makes a privacy claim on the store listing, so the full list of hosts this plugin can cause
traffic to belongs here where it can be checked against. There are three, and they are not all the
same kind of thing — which is exactly the distinction the README has to draw and an earlier version of
this file got wrong.

| # | Host | What reaches it | Kind |
|---|---|---|---|
| 1 | `steamcommunity.com` | a vanity name the user typed | a request this plugin makes |
| 2 | `steamcommunity.com` | the current page's own URL | a request this plugin makes |
| 3 | `cs2tracker.gg` | the SteamID64 of the player the user asked about | **user-initiated navigation, not a plugin request** |

1. **`ResolveVanity` in `backend/main.lua`** fetches `https://steamcommunity.com/id/<vanity>/?xml=1`
   when the user types a custom URL name into the lookup box. The vanity is validated against
   `^[A-Za-z0-9_%-]+$` at 2–32 characters *before* it reaches the format string, so it cannot steer
   the request at another host or escape the path. `verify_ssl` is set explicitly — already the
   library default — so that auditing this request does not require reading the `http` module.
2. **`fromProfileXml` in `webkit/steamid.ts`** fetches the *current page's own* `?xml=1` view while
   resolving a viewed profile's SteamID. This one is easy to overlook because it is automatic rather
   than user-initiated, and because it is conditional: it is step 3 of 4, so it runs only when the URL
   and `g_rgProfileData` have both missed and the document is a profile root. On a `/profiles/<id>/`
   URL step 1 always wins and this never fires.
3. **`https://cs2tracker.gg/stats/<steamid64>`**, from `CS2TRACKER_PROFILE_BASE` in
   `shared/cs2tracker.ts` and therefore present in both bundles. This is the destination of every link
   the plugin builds: the profile button (`webkit/inject-profile.ts`), each friend-row badge
   (`webkit/inject-friendblocks.ts`), and the panel's lookup and **My profile** buttons
   (`frontend/services/steamid.ts`). In the **My profile** case the id is the *signed-in user's own*,
   read from `App.m_CurrentUser.strSteamID`.

Rows 1 and 2 are requests this code issues. Row 3 is **not a request this plugin makes** — it is a URL
handed to Steam or to the system browser when the user clicks, so the navigation is the user's and the
plugin never fetches from `cs2tracker.gg` itself. Building a button sends nothing there; the id travels
only when a link is opened.

That distinction is worth keeping precise, and it is emphatically not a reason to leave it out of the
store listing. Opening a link tells a third party which player the user looked up, and in one case
which player *they* are. A listing that says "sends no data anywhere" is false whatever the mechanism,
so the README states both axes separately: what the plugin requests, and where its links go. There is
no analytics endpoint and no server belonging to this plugin — that part was always true and is worth
saying — but it is a different claim from "nothing leaves your machine", and only the first one is
defensible.

Anything claiming the plugin makes only one request is also wrong, and row 2 is the reason.

## Store review rules the code is shaped by

These are requirements from the plugin database's review, not preferences. Each one has already
changed how something here is written:

- **Steam's own components for settings UI.** `ToggleField`, `TextField`, `Field`, `DialogButton`,
  `Spinner`. No raw `input` or `button` anywhere in the panel, no stylesheet, and no layout of the
  plugin's own — custom-styled settings UI is rejected, which is why the ordering of elements in
  `SettingsPanel.tsx` is the whole of its layout. The one inline style in the frontend bundle is on
  the SVG mark in `frontend/assets/Icon.tsx`, which pins the icon to `1em` square with
  `flexShrink: 0`; it sizes the plugin's own glyph and styles nothing of Steam's.
- **No `innerHTML` with interpolated values.** Injection builds elements with `createElement` and sets
  `textContent`. Markup is parsed in exactly two places, and both are `DOMParser` rather than
  `innerHTML`:
  - `webkit/icon.ts` parses the SVG mark — a static string constant with nothing interpolated into it.
  - `webkit/steamid.ts` parses the body of the `?xml=1` response in `fromProfileXml`. This is the one
    that matters to a reviewer, because its input is a **network response** rather than a constant, so
    it is named here rather than left to be discovered. It is safe for three reasons that hold
    together: the parse is `application/xml` into a detached document that is never connected, so
    nothing in it executes or renders; the only thing read out of it is
    `querySelector('steamID64')?.textContent`, a text node and not markup; and that text is then
    range-checked by `isSteamId64` before it can become part of a URL, so a response containing
    anything other than a well-formed SteamID64 yields `null`. No node from the parsed document is
    ever inserted into the page.
- **No CDP injection machinery.** No debugger-protocol tricks to reach the page; the webkit bundle is
  the supported mechanism and is the only one used.
- **No deprecated Millennium APIs.**
- **Every observer, listener and timer disposed — on page unload.** A `MutationObserver` left connected
  outlives the page it was watching, so `webkit/lifecycle.ts` is a disposer registry and every observer,
  timer and listener registers with it. `disposeAll` runs each disposer at most once, most recent first,
  popping before calling so a thrower cannot be re-run, with the `try`/`catch` inside the loop so one
  failure cannot strand the rest.

  **The trigger is the limit, and it is worth stating rather than implying.** The only path into
  `teardown()` is the non-persisted `pagehide` listener armed in `webkit/index.tsx`. That covers the
  case the store review is asking about — a page going away does not leave anything of this plugin's
  running behind it — and it does not cover the plugin being *disabled*. `@steambrew/webkit` exports no
  unload or disable hook, so there is nothing for the webkit bundle to listen for: Millennium can stop
  loading the bundle into new documents, but it cannot tell an already-loaded one to stand down.

  So disabling the plugin with a friends page open leaves that page as it was — the badges, the profile
  button, the `<style>` element, the `pagehide` listener, and a **connected `MutationObserver` that
  keeps re-badging rows Steam adds**. Closing or reloading the page clears all of it, and this is
  recorded as an API limitation rather than a defect because there is no hook to attach a fix to; do not
  add a polling loop or a heartbeat to work around it, which would trade a bounded gap for an unbounded
  cost on every community page. Revisit if `@steambrew/webkit` gains an unload hook.

  This is the same shape as the settings model's "a toggle applies to the next page, not the ones
  already open", and for the same underlying reason: the webkit bundle's only lifecycle is the
  document's.

`webkit/teardown.ts` exists as its own module for two reasons. It needs nothing from Steam — four
removers and a `Document` — so splitting it out of the entry point is what makes it testable at all.
And it is the function review cares most about, while neither of the two mistakes it can make fails
loudly: move the disposal after the removals, or drop the last line, and the plugin still works
perfectly on every page it was switched on for. `disposeAll` first, because disposal unwinds
construction. `removeStyles` last, because neither remover above it will touch the stylesheet — the
profile button declines in case the badges still need it, the badges decline in case the button does
— so after both is the only correct place. The stylesheet is not cosmetic debt either:
`.friend_block_v2{position:relative}` makes every friend row the containing block for Steam's own
absolutely positioned row descendants, so a page left carrying the sheet after teardown is carrying a
change to Steam's layout with nothing left to justify it.

## Phase 2, and why it was deferred

Phase 2 is badges inside Steam's own **Friends & Chat** window — the client-side friends list, not
the community web page at `/friends/`.

It is deferred, not dropped, and the reason is not effort. That window is rendered by Steam's own
minified React tree in the UI process, so a badge there means patching that tree: locating the
component that renders a friend row inside minified output, wrapping or replacing its render, and
keeping that patch working across Steam client updates that rename everything.

Two things follow. No plugin in the store does this today, so there is no reference implementation to
learn the technique from and no evidence about how review treats it. And it cannot be planned without
live inspection — the component names, the props each row actually carries, and whether a row even
exposes a SteamID at the point where a badge could be attached are all unknowable from outside a
running client. Planning it from documentation would produce a design that has to be thrown away.

The web friends surfaces are covered by phase 1 instead, and cheaply: `/friends/`,
`/friends/coplay/`, `/friends/pending/`, `/friends/blocked/`, group member listings and the friends
widget on a profile are all built from the same `.friend_block_v2[data-steamid]` row markup, so one
selector handles all of them and the injector never has to know which page it is on.

## Verification

### Three typecheck commands, and why no one of them subsumes the others

```bash
pnpm run typecheck                       # frontend and webkit, as separate programs
pnpm exec tsc -p tsconfig.json --noEmit  # the root project — the only one that reaches tests/
pnpm exec tsc -p scripts/tsconfig.json --noEmit  # the build scripts
```

- **`pnpm run typecheck`** compiles `frontend/` and `webkit/` as two separate programs with
  *different ambient types*: `frontend` gets `"types": ["react"]`, `webkit` gets `"types": []` plus
  the DOM libs. That separation is the point. It is what catches a cross-runtime leak — React reached
  for from the webkit bundle, where there is no React — because each program can only see the types
  its runtime actually has.
- **`tsc -p tsconfig.json --noEmit`** sees every `@types` package at once and so *cannot* catch that
  leak. It is here for a different reason: it declares no `include`, so it defaults to the whole tree
  and is the only project that reaches `tests/`. Vitest strips types through esbuild without checking
  them, so a test asserting against a mistyped API would otherwise compile, pass, and keep passing
  forever while documenting an API that does not exist.
- **`tsc -p scripts/tsconfig.json --noEmit`** re-checks `scripts/` under `"types": ["node"]`. The root
  project already *includes* those files, so this is not about coverage — it is about ambient types.
  Under the root config a script can reach a `@types` package it will not have at runtime and still
  compile; this one restricts the scripts to Node's types, which is all they actually run with.

Dropping any one of the three loses a class of error the other two cannot see: the first is the only
one that isolates the two bundles' ambient types from each other, the second is the only one that
compiles `tests/`, and the third is the only one that holds `scripts/` to Node's types alone. CI runs
all three as separate steps for exactly this reason.

### The test suite

```bash
pnpm test
```

Vitest with `happy-dom`. What it can cover is bounded by what can be imported outside the Steam
client: `@steambrew/client` and `@steambrew/webkit` both resolve to globals the Millennium runtime
installs, and `@steambrew/client`'s entry point additionally re-exports its modules extensionlessly,
so Node's ESM resolver rejects it with `ERR_MODULE_NOT_FOUND` before any code runs.

That bound is the reason for the shape of this codebase. Six modules import from a Steam package
directly, and they are as short as they can be:

| Module | What it imports |
|---|---|
| `frontend/index.tsx` | `definePlugin`, `Plugin` |
| `frontend/components/SettingsPanel.tsx` | `ToggleField` |
| `frontend/components/LookupField.tsx` | `DialogButton`, `Field`, `Spinner`, `TextField` |
| `frontend/services/settings.ts` | `toaster`, `usePluginConfig` |
| `frontend/services/steamid.ts` | `callable` |
| `webkit/settings.ts` | `callable` |

Everything that carries a decision has been moved out of them into `shared/`,
`frontend/services/setting-value.ts`, `frontend/services/lookup.ts`, `webkit/routing.ts` and
`webkit/teardown.ts` — all of which the suite reaches. What is left in those six is wiring.

`webkit/index.tsx` is worth a note: it imports nothing from `@steambrew/webkit` itself, but it is
still untestable, because it reaches the package transitively through `webkit/settings.ts` and because
it reads `location` and `document` off the page it is running in. It is the shortest list of wiring
that can work, and it is verified by hand against a live client.

### What no test covers

**Injection selectors.** `.profile_rightcol`, `.friend_block_v2[data-steamid]`, and Steam's
`g_rgProfileData` shape are all facts about Steam's live markup. The tests assert the injectors behave
correctly *given* a document containing those, which is worth having and is not the same claim. If
Steam renames a class, every test still passes and no button appears.

So a change to any selector, or to the markup assumptions around it, has to be checked against a
running Steam client. There is no automated substitute and there cannot be one from outside the
client.

**The build output actually loading.** CI asserts `.millennium/Dist/index.js`,
`.millennium/Dist/webkit.js` and `backend/main.lua` are non-empty (`test -s`, not `test -f`: a
bundler that exits 0 having written nothing is the failure worth catching) and that `plugin.json`
carries its required keys. That is a smoke test for the store's pipeline, not evidence that
Millennium loads either bundle.

### Version drift

`package.json` and `plugin.json` both carry the version and nothing in the build makes them agree.
`scripts/sync-version.ts --check` runs in CI to catch a hand-edit to one of them — silent otherwise,
because the plugin still builds and loads, and the drift only becomes visible once the store shows
the stale number.

### The plugin id

The store derives a plugin's permanent install id from the **first commit not authored by the
template bot**, and the id users type is that commit's first twelve characters. For this repository
that is the root commit `7bac0b37757943db23fc8c9f63e356ab8d70f6fe`, so the install id is
`7bac0b377579`.

`scripts/build-plugin.ts` reproduces that derivation rather than approximating it, and refuses to run
in a shallow clone: `git log` reports only the history that was fetched, so a shallow clone would
return the oldest commit *present* and do it without complaint. A wrong id is not a wrong version —
it is a different plugin as far as the store and every existing install are concerned.
