# Ember

A small, fast todo app for Windows and macOS: press a hotkey anywhere, type a sentence, and you're done.

## Stack

- **Tauri 2**: the Rust side owns the data file, global hotkeys, tray/menu-bar icon, reminder scheduler and start-at-login (`src-tauri/src/lib.rs`)
- **Plain JS + Vite**: three pages, one per window: `index.html` (main), `capture.html` (quick add), `reminder.html` (pop-up)
- `src/parse.js` is the natural-language parser, shared by all windows and covered by `yarn test`

## Run

```bash
yarn install
yarn tauri:dev
```

## Using it

| | Windows | macOS |
|---|---|---|
| Quick add from any app | `Ctrl+Shift+Space` | `⌥ Space` |
| Show/hide Ember | `Ctrl+Shift+J` | `⌘ ⇧ J` |

Both are changeable in Settings. In quick add, **Enter** adds the task and closes the bar, **Shift+Enter** adds it and keeps the bar open, and **Tab** switches between *Todo* and *Waiting on*.

Any task with a **time** gets a reminder pop-up in the bottom-right corner, with Done / 10 min / 1 hour / Tomorrow buttons. Ember lives in the tray (Windows) or menu bar (macOS, where the overdue count shows next to the icon). Reminders only fire while it's running, so turn on *Open at login* in Settings if you want them to work from the moment you log in. It's off until you switch it on.

### Writing tasks

| You type | You get |
|---|---|
| `tomorrow`, `fri`, `next mon`, `next week`, `12/11`, `3 nov`, `2026-11-03` | A due date. The task shows in *Today* on that day |
| `14:30`, `at 9`, `2pm`, `fri 14`, `in 20m`, `in 2h`, `eod`, `eow`, `tonight` | A due time **and a reminder** |
| `remind` + a date | A reminder at 09:00 that day (configurable) |
| `@Alex` | A person |
| `wait:` (or Tab in quick add) | Goes in *Waiting on*: things you've delegated or need to chase |
| `#onboarding` | A tag |
| `!` | A star. Starred tasks stay at the top |

Danish works too: `i morgen`, `fredag`, `kl 10`, `næste uge`. `12.10` is read as a date; for times, use `12:10`.

### Keys in the main window

`N` add · `J/K` move · `X`/`Space` complete · `E`/`Enter` edit (with notes) · `T`/`M`/`Shift+M`/`0` move to today, tomorrow, next Monday, or no date · `S` star · `W` waiting on · `Del` delete · `Ctrl/⌘+Z` undo · `1–5` switch views · `/` search · `?` help

## Data and privacy

Everything stays on your computer in one JSON file, plus a daily backup (the last 14 days are kept):

- Windows: `%APPDATA%\io.baekgaard.ember\ember.json`
- macOS: `~/Library/Application Support/io.baekgaard.ember/ember.json`

The file isn't encrypted by Ember; it relies on your OS account and disk encryption (BitLocker / FileVault). Deleted tasks remain in the backups for up to 14 days.

On first launch, Ember imports data from the earlier Jot builds (`io.baekgaard.jot/jot.json` next to the folder above, or the Electron prototype's `%APPDATA%\jot\jot.json`) if one exists. If a file can't be parsed, it is copied aside before anything new is written; if it can't be read at all, Ember shows an error and quits without touching it.

The only network request Ember makes is the update check described below. There is no telemetry, no account and no sync.

## Releases

`.github/workflows/build-mac.yml` builds a universal macOS `.dmg`, signed and notarized when the `APPLE_*` secrets are set. Pushing a `v*` tag creates a draft GitHub Release with `latest.json`, and installed copies update themselves from it (`TAURI_SIGNING_PRIVATE_KEY` secret; the public key is in `tauri.conf.json`). Bump the version in both `tauri.conf.json` and `Cargo.toml` before tagging.

Windows: `yarn tauri:build` → `src-tauri/target/release/bundle/nsis/`. These builds are unsigned, so SmartScreen will warn.

## Dev self-test

```bash
EMBER_SELFTEST=1 EMBER_DATA=<tmpdir> EMBER_SHOTS=<outdir> yarn tauri dev
```

Debug builds only. This seeds sample data in a throwaway folder, drives every window, takes screenshots (Windows), prints `SELFTEST PASS/FAIL` lines and exits.
