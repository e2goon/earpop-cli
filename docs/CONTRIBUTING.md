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

## Pull requests (Cursor Origin)

Open and merge PRs on **GitHub** (`gh pr` is fine when the human asks).

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

1. Bump `"version"` in root `package.json` (platform package versions are synced on publish).
2. Commit on the branch you intend to tag (usually `main`).
3. Tag and push: `git tag vX.Y.Z && git push origin vX.Y.Z` (tag must match `package.json`, including the `v` prefix only on the tag).
4. Ensure repo secret **`NPM_TOKEN`** is set (npm automation token with publish rights).
5. Actions (`.github/workflows/capture.yml`) builds all capture binaries, publishes `earpop-capture-*` then `earpop-cli`, creates/updates the GitHub Release, and commits integrity hashes to the default branch.

Manual publish (`node scripts/publish-capture.mjs --publish`) is for debugging only when CI cannot run.
