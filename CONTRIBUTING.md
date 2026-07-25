# Contributing

Thanks for taking an interest. This file covers what you need to get a change built, verified and
accepted.

Read [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) before your first change. It records the constraints
that are invisible in the code — several of which fail silently, so you will not find out you broke
them from a test or a build error.

## Setup

You need [Node.js](https://nodejs.org/) 24 or newer and [pnpm](https://pnpm.io/) 10 or 11.

```bash
git clone https://github.com/MuhammedResulBilkil/cs2tracker-extension.git
cd cs2tracker-extension
pnpm install
```

**Use pnpm.** Not npm, not bun. The plugin store's CI runs `pnpm install`, so `pnpm-lock.yaml` is the
lockfile that decides which versions anything is ever built against; a `bun.lock` or
`package-lock.json` would be ignored by it and is gitignored here so it cannot be committed by
accident.

### Scripts

```bash
pnpm run dev        # one-off development build
pnpm run watch      # rebuild on change
pnpm run build      # production build
pnpm run typecheck  # type check the frontend and webkit bundles
pnpm test           # run the test suite
pnpm run test:watch # run the suite in watch mode
```

### Running your build in Steam

The build writes `.millennium/Dist/index.js` and `.millennium/Dist/webkit.js`. To load them, put the
repository where Millennium looks for plugins — a symlink is easiest, so a rebuild does not need a
copy step:

| OS | Plugins directory |
|---|---|
| Windows | `C:\Program Files (x86)\Steam\millennium\plugins\` |
| Linux | `~/.local/share/millennium/plugins/` |
| macOS | `~/Library/Application Support/millennium/plugins/` |

Enable the plugin under **Millennium → Plugins** and restart Steam. Reloading is not enough for
changes to `plugin.json` or to the Lua backend.

## Commit messages

**[Conventional Commits](https://www.conventionalcommits.org/) is required.**

This is not a style preference. `semantic-release` parses commit subjects on every push to `master` to
decide what the next version is, what goes in `CHANGELOG.md`, and whether to release at all. A subject
it cannot classify contributes nothing: no version bump, no changelog entry, and — if it is the only
commit in the range — no release, silently, with the workflow exiting 0.

```
feat: add a badge to group member listings
fix: stop the profile button duplicating on back navigation
docs: explain the webkitApiVersion requirement
```

| Type | Effect on the version |
|---|---|
| `fix:`, `perf:`, and a revert | patch |
| `feat:` | minor |
| any type with `!` or a `BREAKING CHANGE:` footer | major |
| `docs:`, `chore:`, `test:`, `refactor:`, `ci:`, `build:`, `style:` | none |

`perf:` is in the patch row and not the none row, which surprises people: `release.config.mjs` passes no
`releaseRules` override, so `@semantic-release/commit-analyzer` uses its own defaults, and those ship
`{ type: "perf", release: "patch" }`. If you want a performance change not to cut a release, label it
`refactor:`.

Write the subject for the changelog, because that is literally where it ends up: imperative mood, no
trailing period, and describing the change from a user's point of view where the change has one.

## Before you open a pull request

Every one of these must pass. They are the complete set of gates CI applies, in the order it applies
them — CI will not let a red branch merge, but running them locally is faster than finding out from a
workflow.

```bash
pnpm run typecheck                               # frontend and webkit, as separate programs
pnpm exec tsc -p tsconfig.json --noEmit          # the root project — the only one that reaches tests/
pnpm exec tsc -p scripts/tsconfig.json --noEmit  # the build scripts, under Node's types alone
pnpm exec tsx scripts/sync-version.ts --check    # package.json and plugin.json agree on the version
pnpm test
pnpm run build
```

After the build, CI additionally asserts that `.millennium/Dist/index.js`,
`.millennium/Dist/webkit.js` and `backend/main.lua` are all non-empty, and that `plugin.json` still
carries `name`, `common_name`, `version`, `backendType` and `webkitApiVersion`. Those are smoke tests
for the store's own pipeline; a successful local `pnpm run build` covers the same ground.

**Run all three typechecks.** No one of them subsumes the others, and it is not obvious why —
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#three-typecheck-commands-and-why-no-one-of-them-subsumes-the-others)
has the full reasoning. Briefly: `pnpm run typecheck` compiles the frontend and webkit bundles as
separate programs with different ambient types, which is the only way a cross-runtime type leak is
caught; the root project is the only one that reaches `tests/`, which matters because vitest strips
types without checking them; and the third covers `scripts/`, which nothing else includes.

`pnpm run build` is in the list rather than a footnote to it: a change can typecheck and still fail to
bundle, and the store's CI runs `pnpm install && pnpm run build` as its first act.

### New behaviour needs a test

If your change adds or alters a decision, put that decision somewhere the suite can reach it —
`shared/`, `webkit/routing.ts`, `webkit/teardown.ts`, `frontend/services/setting-value.ts` — and test
it there.

Any module that imports from `@steambrew/client` or `@steambrew/webkit` cannot be tested at all,
because those packages resolve to globals that exist only inside the Steam client. Four modules do
(`frontend/index.tsx`, `frontend/components/SettingsPanel.tsx`, `frontend/services/settings.ts`,
`webkit/settings.ts`), and they are deliberately kept to wiring and hold no logic. Adding a decision to one of them makes it untestable,
so please do not: extract it instead.

### Changes to injection selectors need a live Steam client

**There is no automated coverage for whether a selector matches Steam's real markup, and there cannot
be.** `.profile_rightcol`, `.friend_block_v2[data-steamid]` and the shape of `g_rgProfileData` are
facts about Steam's live pages. The tests assert the injectors behave correctly *given* a document
containing those — a worthwhile claim, and not the same one. If Steam renames a class, every test
still passes and no button appears anywhere.

So if you change a selector, the markup assumptions around it, the SteamID resolution order, or
anything in `webkit/inject-profile.ts`, `webkit/inject-friendblocks.ts`, `webkit/steamid.ts` or
`webkit/styles.ts`, verify it against a running Steam client and say so in the pull request. Please
state what you checked:

- a `/profiles/<id>/` profile **and** an `/id/<vanity>/` profile
- **somebody else's** profile, not only your own — a SteamID resolved from the wrong source looks
  perfectly correct on your own profile and lies on every other one
- `/friends/` and at least one other friends surface (`/friends/coplay/`, `/friends/pending/`, or a
  group member listing)
- a non-profile community page, to confirm nothing is injected where it should not be
- navigating away and back, to confirm teardown ran and nothing is duplicated
- both settings states for whatever you touched, and both values of **Open in external browser** if
  your change affects a link

CSS changes to `webkit/styles.ts` deserve extra care: `.friend_block_v2` is Steam's own class, and
`position: relative` on it is not visually inert — it makes each row the containing block for any
absolutely positioned descendant Steam already has in there. Check the rows still look right, not
just the badge.

## Pull requests

- One logical change per pull request.
- Say what you verified by hand, using the checklist above where it applies.
- Line endings are LF. `.gitattributes` enforces it; do not fight it.
- Formatting follows the existing files, and indentation is per-language rather than repo-wide: tabs in
  TypeScript, four spaces in `backend/main.lua`, four spaces in the workflow YAML. Match the file you
  are editing. Single quotes in TypeScript.
- Comments in this codebase explain *why*, and especially why something that looks removable is not.
  If your change makes one of them wrong, fix the comment in the same commit. If you find yourself
  deleting one because the rule looks arbitrary, check `docs/ARCHITECTURE.md` first — several of them
  are guarding a silent failure.

## Reporting a bug

Use the [issue templates](https://github.com/MuhammedResulBilkil/cs2tracker-extension/issues/new/choose).
The plugin, Millennium and Steam-channel versions are all asked for because the injection surfaces
change with the Steam client, and a report without them usually cannot be reproduced.

## License

By contributing you agree that your contributions are licensed under the [MIT License](LICENSE.md).
