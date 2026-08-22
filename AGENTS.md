# AGENTS

How coding agents should work in this repository.

| Doc                                            | Role                                           |
| ---------------------------------------------- | ---------------------------------------------- |
| [README.md](./README.md)                       | Users and npm: install, usage, env, storage    |
| [CONVENTIONS.md](./CONVENTIONS.md)             | How to write code (style and TypeScript rules) |
| [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) | Why the system is shaped this way              |
| **This file**                                  | Agent workflow, tooling, and boundaries        |

Do not duplicate those docs here — follow the link for the topic.

## Workflow

- Prefer the smallest change that satisfies the request.
- Follow [CONVENTIONS.md](./CONVENTIONS.md) for every code edit.
- Respect [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) hot/cold path and layer boundaries.
- **Do not** `publish`, **commit**, or **push** unless the human asked.
- **Do not** invent a GitHub / `repository` URL if none exists.
- **Do not** commit `.cursor/` (gitignored). Shared guidance is this file + `CONVENTIONS.md`. Commit `.vscode/` Oxc recommendations only.
- Public package: keep the repo **English-only** (see CONVENTIONS).

## Tooling

- Node **20+**, **pnpm**
- `pnpm dev` — run CLI via tsx
- `pnpm build` — **tsup** → `dist/` (keep tsup unless there is a concrete need; do not switch to Rolldown/`tsdown` for speed alone)
- `pnpm check` — `tsc --noEmit`
- `pnpm lint` / `lint:fix` — Oxlint
- `pnpm fmt` / `fmt:check` — Oxfmt
- Publish surface: `bin.earpop` → `dist/index.js`; npm `files`: **`dist` only**

## Layout (where to edit)

```text
src/
  app/          # live/settings wiring, argv commands
  screens/      # ink screens
  components/   # shared UI pieces
  hooks/
  lib/          # audio, soniox, journal, settings, transcription controller
```

Import alias: `#/*` → `src/*` (tsconfig + tsup).
