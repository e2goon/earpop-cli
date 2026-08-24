# AGENTS

Agent workflow for this repo. Details live in linked docs — do not duplicate them here.

| Doc | Role |
| --- | --- |
| [README.md](./README.md) | Users / npm |
| [docs/CONVENTIONS.md](./docs/CONVENTIONS.md) | Code style |
| [docs/CONTRIBUTING.md](./docs/CONTRIBUTING.md) | Commits, PRs, release |
| [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) | Hot/cold design intent |

## Rules

- Smallest change that satisfies the request.
- Follow CONVENTIONS on every edit; CONTRIBUTING when committing or opening a PR (only if asked).
- Respect ARCHITECTURE hot/cold boundaries (React draws only; audio/WS/journal outside React).
- Do **not** publish, commit, or push unless asked. Strip `Co-authored-by: Cursor` if a hook inserts it.
- Do **not** commit `.cursor/`. Shared guidance is this file + `docs/`.
- Public package surface (code, UI, README): **English**.
- Remote: GitHub `origin`. Release: `pnpm release` (see CONTRIBUTING). Prefer `gh` for PRs when asked.

## Notes agents miss from the tree

- Import alias `#/*` → `src/*` (tsconfig + tsup).
- Capture platforms: `src/lib/capture-platforms.json` must stay aligned with `.github/workflows/capture.yml`.
- Scripts and engines: see root `package.json` (`pnpm capture:*`, `pnpm release`, `pnpm check` / `lint` / `fmt`).
