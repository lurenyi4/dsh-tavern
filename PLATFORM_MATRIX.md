# Story Runtime platform candidate matrix

Updated: 2026-10-05. This is a source-run candidate, not a four-platform release certification. The original requirement includes local Android APK/host execution, file content URIs, local durable storage and resume. A phone accessing a desktop server does not satisfy it.

## Current evidence

| Target | Delivery entry | Evidence in this change | Remaining gate |
| --- | --- | --- | --- |
| Linux | `bash start-story-runtime-linux.sh` | Node 24.19.0 platform/CLI tests on cloud Linux; POSIX argument forwarding, Unicode/space paths, help/version with absent runtime | Final core/HTTP regression and real browser/desktop smoke remain separate gates |
| macOS | `bash start-story-runtime-macos.command` | Same shell wrapper executed under Linux Bash; path selection unit-tested | **not_run** on macOS or Apple Silicon; real filesystem, SQLite, installation, startup, browser, quit/reopen and backup/restore |
| Windows | `start-story-runtime-windows.cmd` | Native Windows path computation unit-tested on Linux; `.cmd` source supplied | **not_run** on Windows; cmd argument forwarding, npm setup, SQLite, Chinese paths, directory flush semantics, startup/reopen and backup/restore |
| Android | No new native package supplied | No Android execution evidence; generic path calculation does not establish support | **blocked**: native APK/host driver bridge, content URI import and resource access, storage transactions, kill/reopen, background limits and target device/runtime record |

No device, architecture or OS version is certified by these unit tests. The inherited `android/` tree does not prove that the new `world-runtime` is integrated into that host. There is deliberately no Android launcher that silently substitutes a remote webpage or an unvalidated terminal runtime. Native integration needs the target runtime and a separate implementation/acceptance pass.

## Run locally

Prerequisite: stable Node.js >=24.19.0, with its bundled npm available. Keep the complete source tree, including `world-runtime`, `config/cli-runtime`, and its pinned lockfile. The candidate's Story Runtime version is 0.1.0; the inherited host package version is separate.

From the repository root, explicitly install the locked host runtime once:

```sh
npm run install:world-runtime
```

This is an npm dependency installation, not performed by any launcher. It uses the existing pinned host lock and disables lifecycle scripts. An already prepared runtime may instead be selected with `STORY_DSH_RUNTIME_DIR`. Windows installer behavior needs a real Windows test.

Then choose your desktop entry:

```sh
# Linux
bash start-story-runtime-linux.sh serve --port 3089
# macOS terminal (does not require changing executable permissions)
bash start-story-runtime-macos.command serve --port 3089
# Any Node-capable desktop terminal, from the source root
node world-runtime/cli.mjs serve --port 3089
```

Windows Command Prompt:

```bat
start-story-runtime-windows.cmd serve --port 3089 --data-dir "D:\Story Data"
```

The console prints the loopback URL. Open that URL in a browser yourself. Stop with Ctrl+C; subsequent startup with the same data directory reopens existing local data. Launchers do not download dependencies, open browsers, copy existing user data or change execution/security settings. If Node is absent, they exit with an installation instruction. Paths supplied by the user are relative to the calling terminal's working directory, not silently rebased to the source directory.

## Data and restore

`--data-dir` takes precedence over `STORY_DATA_DIR`, then these defaults:

- Windows: `%LOCALAPPDATA%\Story Runtime`, falling back to the home `AppData\Local` directory
- macOS: `~/Library/Application Support/Story Runtime`
- Linux: `$XDG_DATA_HOME/story-runtime`, falling back to `~/.local/share/story-runtime`; relative `XDG_DATA_HOME` values are ignored

Do not use a shared/synchronized directory as a concurrently writable database. Cross-platform portability is via the app's versioned backup, not automatic copying or merging of live user directories. Destination platform restore must still be tested.

```sh
node world-runtime/cli.mjs restore "story-runtime.story-backup.json" --data-dir "/path/to/new-directory"
```

Restore requires an explicit destination; the backup layer decides whether it is safe and does not already exist. CLI does not silently restore into the default live profile. The desktop wrappers forward `restore` unchanged. Metadata commands do not import the runtime, install packages, open a listener or create a data directory:

```sh
node world-runtime/cli.mjs --help
node world-runtime/cli.mjs --version
```

## Reproduce focused checks

```sh
node --test world-runtime/test/platform.test.mjs world-runtime/test/cli-help.test.mjs
bash -n start-story-runtime-linux.sh start-story-runtime-macos.command
```

Tests isolate the CLI in a temporary directory without server dependencies. Coverage includes early help/version, malformed arguments/ports, explicit restore destination, restore-only imports, Unicode/space paths, environment precedence, native Windows default separators and POSIX wrapper argument/exit propagation. POSIX wrappers are run on Linux, not on a macOS device; `.cmd` is not executed by these tests.

## Required real-target smoke record

For each target, record OS version, architecture, device, Node/host/SQLite driver versions, source commit and exact commands/logs. Test installation; import JSON/PNG/resources from a Unicode path (Android: content URI); local demo generation and cancellation; commit/state consistency; quit/kill and reopen; backup and restore into a fresh directory; import bounds and resource memory; model streaming using an explicitly configured service if authorized. Android additionally needs lock/background/foreground recovery without promising unrestricted background execution. Record passed, failed, not_run or blocked individually; no desktop or in-memory test substitutes for a mobile run or physical power-loss durability.
