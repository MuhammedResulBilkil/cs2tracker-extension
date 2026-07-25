<img src="assets/icon-mono.svg" alt="" width="28" align="left">

# CS2Tracker Extension

A [Millennium](https://steambrew.app/) plugin that puts [CS2Tracker](https://cs2tracker.gg) one click away from any Steam profile.

> Unofficial community plugin. Not affiliated with, endorsed by, or operated by CS2Tracker or Valve.

![The CS2Tracker button on a Steam profile](assets/screenshots/profile-button.png)

## Features

- **Profile button** — every Steam community profile gets a CS2Tracker button linking to that player's stats.
- **Friend list badges** — your friends list, pending list, and recently-played-with list each get a per-row badge.
- **In-client lookup** — paste a SteamID64, a profile URL, or a custom URL name into the plugin panel and jump straight to that player.
- **Browser choice** — open CS2Tracker inside Steam or hand it to your system browser.

![Badges on the friends list](assets/screenshots/friend-list.png)

## Requirements

[Millennium](https://steambrew.app/) installed and running.

## Installation

### From the plugin store

1. Open Steam with Millennium installed.
2. Go to **Millennium → Plugins**.
3. Click **Install a plugin**.
4. Paste the plugin ID: `7bac0b377579`
5. Click **Install**, then restart Steam when prompted.

### From source

```bash
git clone https://github.com/MuhammedResulBilkil/cs2tracker-extension.git
cd cs2tracker-extension
pnpm install
pnpm run build
```

Then copy or symlink the folder into your Millennium plugins directory:

| OS | Path |
|---|---|
| Windows | `C:\Program Files (x86)\Steam\millennium\plugins\cs2tracker-extension` |
| Linux | `~/.local/share/millennium/plugins/cs2tracker-extension` |
| macOS | `~/Library/Application Support/millennium/plugins/cs2tracker-extension` |

Restart Steam and enable the plugin under **Millennium → Plugins**.

## Settings

![The settings panel](assets/screenshots/settings-panel.png)

| Setting | Default | What it does |
|---|---|---|
| Show on profile pages | On | Adds the CS2Tracker button to Steam community profiles |
| Show on friend lists | On | Adds a badge to each friend row |
| Open in external browser | Off | Opens CS2Tracker in your system browser instead of Steam's built-in one |

Profile pages you already have open keep their old settings. Reopen them to apply a change.

## How it works

The plugin runs in three places. A Lua backend stores your settings and resolves custom URL names to Steam IDs. A React panel inside Steam's own UI renders the settings and the lookup box using Steam's component library. A webkit bundle runs inside Steam's community browser and does the actual page injection, reading each profile's Steam ID from the page rather than from your own account.

It sends no data anywhere, and it has no server, no analytics and no telemetry of its own. The only host it ever talks to is Steam, for two things: reading the Steam ID of a profile page you are already looking at, and resolving a custom URL name you type into the lookup box. Nothing else leaves your machine.

## Development

```bash
pnpm install
pnpm run dev        # one-off development build
pnpm run watch      # rebuild on change
pnpm run build      # production build
pnpm run typecheck  # type check both bundles
pnpm test           # run the test suite
```

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the design notes and [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request.

## License

MIT — see [LICENSE.md](LICENSE.md).

## Links

- [Millennium](https://steambrew.app/)
- [Millennium plugin store](https://steambrew.app/plugins)
- [CS2Tracker](https://cs2tracker.gg)
