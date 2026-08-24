# Contributing

Git and review conventions for this repository. Follows [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/). Code style: [CONVENTIONS.md](./CONVENTIONS.md). Agent boundaries: [AGENTS.md](../AGENTS.md).

**Remote:** **GitHub** as `origin` (`https://github.com/e2goon/earpop-cli.git`). Do not invent a `repository` URL in `package.json` unless publishing metadata needs it.

## Commits

Format:

```text
<type>(<optional scope>)<!?>: <한글 설명>

[optional 한글 body]

[optional footer]
```

Rules:

- **type** (required, English): see table below — keep as `feat`, `fix`, etc.
- **scope** (optional, English): area of the change (`cli`, `auth`, `audio`, `docs`, …)
- **description** (Korean): short summary of what changed; no trailing period; keep the subject line readable (~72 characters when practical)
- **body** (Korean): explain **why** when the subject is not enough; blank line after the subject
- **breaking change**: `feat!:` / `fix!:` and/or a `BREAKING CHANGE:` footer (token stays English; explanation may be Korean)
- Do **not** add `Co-authored-by: Cursor <…>` trailers

| Type       | Use for                                | SemVer (when releasing) |
| ---------- | -------------------------------------- | ----------------------- |
| `feat`     | User-facing feature                    | minor                   |
| `fix`      | Bug fix                                | patch                   |
| `docs`     | Documentation only                     | —                       |
| `refactor` | Code change with no feature/fix        | —                       |
| `perf`     | Performance improvement                | patch (often)           |
| `test`     | Tests only                             | —                       |
| `build`    | Build system or bundler                | —                       |
| `ci`       | CI configuration                       | —                       |
| `chore`    | Maintenance that does not affect users | —                       |
| `style`    | Formatting only (no logic change)      | —                       |

Examples:

```text
feat(cli): ink 호환을 위해 Node 24 이상 요구
fix(auth): 현재 리전의 키체인 API 키 삭제
docs: Node 24 요구사항 문서화
chore(release): engines와 prepublishOnly 정렬
feat!: Node 22 지원 제거
```

Do **not** commit unless the maintainer (or user, for agents) asked.

## Pull requests

Open and merge PRs on **GitHub** (`gh pr` when the human asks).

**Title:** same as a commit subject — English `type` + Korean description. Prefer **squash merge**; the PR title becomes the history entry.

**Body (Korean):**

```markdown
## Summary

- …

## Test plan

- [ ] …

## Notes

<!-- Optional: breaking changes, follow-ups -->
```

1. **Summary** — 무엇을, 왜 바꿨는지 (1–3 bullets)
2. **Test plan** — 검증 방법 체크리스트
3. **Notes** (optional) — 브레이킹 변경, 후속 작업

Keep PRs focused and small when possible.

## Local checks before review

```bash
pnpm check
pnpm lint
pnpm fmt:check
pnpm build
```

Capture sidecar (optional): `pnpm capture:build`. Release packaging is documented in [ARCHITECTURE.md](./ARCHITECTURE.md).

## Release (npm + GitHub)

Repo secret **`NPM_TOKEN`** required. On a clean tree (usually `main`):

```bash
pnpm release          # patch
pnpm release minor    # or major, or 0.3.0
pnpm release --dry-run
```

Bumps versions, commits `chore: x.y.z`, tags `vx.y.z`, pushes. Actions builds, publishes, and opens the GitHub Release.
