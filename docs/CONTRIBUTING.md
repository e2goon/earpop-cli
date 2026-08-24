# Contributing

[Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/). Code style: [CONVENTIONS.md](./CONVENTIONS.md).

**Remote:** GitHub `origin` (`https://github.com/e2goon/earpop-cli.git`). Root and `npm/earpop-capture-*` `package.json` set `repository.url` for npm provenance on tag publish.

## Commits

```text
<type>(<optional scope>)<!?>: <한글 설명>

[optional 한글 body]
```

- **type** / **scope**: English (`feat`, `fix`, `cli`, …)
- **description** / **body**: Korean; subject ~72 chars when practical; no trailing period on subject
- Breaking: `feat!:` / `fix!:` and/or `BREAKING CHANGE:` footer
- No `Co-authored-by: Cursor` trailers
- Commit only when the maintainer asks

| Type | Use |
| --- | --- |
| `feat` | User-facing feature |
| `fix` | Bug fix |
| `docs` | Docs only |
| `refactor` | No feature/fix |
| `perf` | Performance |
| `test` / `build` / `ci` / `chore` / `style` | As named |

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
