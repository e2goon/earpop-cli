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
- Rust (**1.85+**) for the capture sidecar (`crates/earpop-capture`) — **host build only** for local work
- `pnpm capture:build` — Node script: `cargo build --release` + stage into `npm/earpop-capture-<platform>/bin/` (PowerShell / cmd OK; no bash/Docker)
- `pnpm capture:stage` — stage an already-built binary for this host
- `pnpm capture:publish:check` — verify staged binaries (use `node scripts/publish-capture.mjs --publish` to publish)
- `pnpm dev` — run CLI via tsx (prefers `target/release`, then optional/workspace capture package)
- `pnpm build` / `prepublishOnly` — **tsup** → `dist/` only (capture binaries come from CI + platform packages)
- Capture release matrix: [`.github/workflows/capture.yml`](./.github/workflows/capture.yml) (native runners; no local Docker)
- `pnpm check` — `tsc --noEmit`
- `pnpm lint` / `lint:fix` — Oxlint
- `pnpm fmt` / `fmt:check` — Oxfmt
- Publish surface: `bin.earpop` → `dist/index.js`; npm `files`: **`dist`**; capture via **`optionalDependencies`** (`earpop-capture-*`)

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

npm/
  earpop-capture-*/  # one binary per os/cpu (staged by build/CI; published separately)

docs/           # CONVENTIONS, CONTRIBUTING, ARCHITECTURE (not user-facing npm docs)
```

Import alias: `#/*` → `src/*` (tsconfig + tsup).
Binaries under `npm/*/bin/` (except `.gitkeep`) and `target/` are gitignored; CI stages them for release.
