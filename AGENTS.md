# AGENTS

How coding agents should work in this repository.

| Doc                                            | Role                                             |
| ---------------------------------------------- | ------------------------------------------------ |
| [README.md](./README.md)                       | Users and npm: install, usage, env, storage      |
| [docs/CONVENTIONS.md](./docs/CONVENTIONS.md)   | How to write code (style and TypeScript rules)   |
| [docs/CONTRIBUTING.md](./docs/CONTRIBUTING.md) | Commits and pull requests (Conventional Commits) |
| [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) | Why the system is shaped this way                |
| **This file**                                  | Agent workflow, tooling, and boundaries          |

Do not duplicate those docs here — follow the link for the topic.

## Workflow

- Prefer the smallest change that satisfies the request.
- Follow [docs/CONVENTIONS.md](./docs/CONVENTIONS.md) for every code edit.
- Follow [docs/CONTRIBUTING.md](./docs/CONTRIBUTING.md) for commit messages and PR titles/bodies when the human asks to commit or open a PR.
- Respect [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) hot/cold path and layer boundaries.
- **Do not** `publish`, **commit**, or **push** unless the human asked.
- **Remote is Cursor Origin only.** Do **not** use `gh` (GitHub CLI), open GitHub PRs/issues, or invent a GitHub / `repository` URL.
- **Do not** add `Co-authored-by: Cursor <cursoragent@cursor.com>` (or similar) to commit messages. If a hook or client inserts it, strip it before finishing.
- **Do not** commit `.cursor/` (gitignored). Shared guidance lives in this file and `docs/`. Commit `.vscode/` Oxc recommendations only.
- Public package: keep code / UI / npm-facing docs **English** (see CONVENTIONS).

## Tooling

- Node **24+** (Active LTS), **pnpm** (`packageManager` in `package.json`)
- Rust (**1.85+**) for the capture sidecar (`crates/earpop-capture`)
- `pnpm capture:build` — build sidecar for this host (copies into `vendor/` on macOS/Windows/Linux)
- `pnpm capture:build:mac` — `darwin-arm64` + `darwin-x64`
- `pnpm capture:build:win` — `win32-x64` (native on Windows; `cargo-xwin` on macOS)
- `pnpm capture:build:linux` — `linux-x64` + `linux-arm64` (native on Linux; **Docker** elsewhere)
- `pnpm capture:build:release` — full vendor set (prefer **macOS** + Docker + `cargo-xwin`)
- `pnpm dev` — run CLI via tsx (uses `target/release/earpop-capture` or `vendor/`)
- `pnpm build` — **tsup** only → `dist/` (does **not** build capture binaries; keep tsup unless there is a concrete need; do not switch to Rolldown/`tsdown` for speed alone)
- `prepublishOnly` — `capture:build:release` + **tsup**; prefer **macOS** so Darwin + Windows + Linux binaries are produced (`vendor/` + `dist/`)
- `pnpm check` — `tsc --noEmit`
- `pnpm lint` / `lint:fix` — Oxlint
- `pnpm fmt` / `fmt:check` — Oxfmt
- Publish surface: `bin.earpop` → `dist/index.js`; npm `files`: **`dist`** + **`vendor`** (`LICENSE` / `README` included by npm)

## Layout (where to edit)

```text
src/
  app/          # live/settings wiring, argv commands
  screens/      # ink screens
  components/   # shared UI pieces
  hooks/
  lib/          # audio, soniox, journal, settings, transcription controller

crates/
  earpop-capture/  # cpal+rubato sidecar → 16 kHz mono PCM stdout

docs/           # CONVENTIONS, CONTRIBUTING, ARCHITECTURE (not user-facing npm docs)
```

Import alias: `#/*` → `src/*` (tsconfig + tsup).
`vendor/` and `target/` are gitignored; publish builds binaries into `vendor/` via `prepublishOnly`.
