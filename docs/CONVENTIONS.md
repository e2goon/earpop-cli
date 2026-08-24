# Conventions

## Language

- **English:** UI, code comments, npm-facing docs. Comments: non-obvious **why** only.
- **Korean:** commit/PR title description + body. Types/scopes stay English — [CONTRIBUTING.md](./CONTRIBUTING.md).

## Naming

- Files: **kebab-case**
- Components: named function exports (`export function Foo() {}`)
- Import alias: `#/*` → `src/*`

## TypeScript

Do **not** annotate return types on implementations — let inference work. Keep annotations for type predicates, interface/type members, and rare recursive cases.

**2+ parameters:** one destructured object (not positional; not `options` then unpack).

```ts
export async function saveApiKey({ key, region }: { key: string; region: SttRegion }) {}
```

Shared shapes may use a named type. React: single `props` object.

## Helpers

Extract a pure helper only with a clear name **and** more than one call site (or a public module surface). Do not extract one-off “neatness” helpers — inline them.
