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
- **Remote / CI:** GitHub `origin`. Release flow: [CONTRIBUTING.md](./docs/CONTRIBUTING.md) (`pnpm release` → [capture.yml](./.github/workflows/capture.yml)). Prefer `gh` for PRs when the human asks.
- **Do not** add `Co-authored-by: Cursor <cursoragent@cursor.com>` (or similar) to commit messages. If a hook or client inserts it, strip it before finishing.
- **Do not** commit `.cursor/` (gitignored). Shared guidance lives in this file and `docs/`. Commit `.vscode/` Oxc recommendations only.
- Public package: keep code / UI / npm-facing docs **English** (see CONVENTIONS).

## Tooling

- Node **24+** (Active LTS), **pnpm** (`packageManager` in `package.json`)
- Rust (**1.85+**) for the capture sidecar (`crates/earpop-capture`) — **host build only** for local work
- `pnpm capture:build` — host `cargo build --release` + stage into `npm/earpop-capture-<platform>/bin/`
- `pnpm capture:stage` — stage an already-built binary for this host
- `pnpm capture:check` — dry-run staged capture binaries (`--all` / `--publish` via script; publish is CI)
- `pnpm release` — bump version, commit, tag `v*`, push (CI publishes)
- `pnpm dev` / `pnpm build` — tsx / tsup → `dist/`
- Platforms: [`src/lib/capture-platforms.json`](./src/lib/capture-platforms.json) (keep Actions matrix in sync)
- Integrity: [`src/lib/capture-integrity.json`](./src/lib/capture-integrity.json); `EARPOP_SKIP_CAPTURE_INTEGRITY=1` for local bins when hashes are set
- `pnpm check` / `lint` / `fmt` — tsc, Oxlint, Oxfmt
- Publish surface: `bin.earpop` → `dist/index.js`; npm `files`: **`dist`**; mic via **`optionalDependencies`**

## Layout (where to edit)

```text
src/
  app/          # live/settings wiring, argv commands
  screens/      # ink screens
  components/   # shared UI pieces
  hooks/
  lib/          # audio, capture-bin, soniox, journal, settings, transcription

crates/
  earpop-capture/  # cpal+rubato sidecar → 16 kHz mono PCM stdout

npm/
  earpop-capture-*/  # one binary per os/cpu (staged by build/CI; published separately)

scripts/        # build-capture / stage-capture / publish-capture / release (Node)

docs/           # CONVENTIONS, CONTRIBUTING, ARCHITECTURE

.github/workflows/  # GitHub Actions (capture matrix)
```

Import alias: `#/*` → `src/*` (tsconfig + tsup).
Binaries under `npm/*/bin/` (except `.gitkeep`) and `target/` are gitignored.
