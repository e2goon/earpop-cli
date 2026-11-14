# Contributing

[Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/). Code style: [CONVENTIONS.md](./CONVENTIONS.md).

**Remote:** GitHub `origin` (`https://github.com/e2goon/earpop-cli.git`). Root and `npm/earpop-capture-*` `package.json` set `repository.url` for npm provenance on tag publish.

## Commits

```text
<type>(<optional scope>)<!?>: <description>

[optional body]
```

- **type** / **scope**: English (`feat`, `fix`, `cli`, …)
- **description** / **body**: English; subject ~72 chars when practical; no trailing period on subject
- Breaking: `feat!:` / `fix!:` and/or `BREAKING CHANGE:` footer
- No `Co-authored-by: Cursor` trailers
- Commit only when the maintainer asks

| Type                                        | Use                 |
| ------------------------------------------- | ------------------- |
| `feat`                                      | User-facing feature |
| `fix`                                       | Bug fix             |
| `docs`                                      | Docs only           |
| `refactor`                                  | No feature/fix      |
| `perf`                                      | Performance         |
| `test` / `build` / `ci` / `chore` / `style` | As named            |

## Checks

`pnpm check`, `pnpm lint`, `pnpm fmt:check`, and `pnpm test` (node:test, `src/**/*.test.ts`) must pass; CI runs them on every push to `main` and every pull request. Tests that touch settings or transcripts use `useTempHome()` so they never read or write the real `~/.earpop`.

## Pull requests

GitHub (`gh pr` when asked). Title = commit subject. Prefer squash merge.

```markdown
## Summary

- …

## Test plan

- [ ] …
```

## Release

Repo secret `NPM_TOKEN`. Clean tree on `main`:

```bash
pnpm release          # patch; or: minor | major | 0.3.0
pnpm release --dry-run
```

CI on tag `v*` builds capture binaries, publishes, and opens the GitHub Release.
