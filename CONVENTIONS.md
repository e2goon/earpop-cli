# Conventions

How to write code in this repository. Agent workflow: [AGENTS.md](./AGENTS.md). Design intent: [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md).

## Language

- **English only** for UI strings, docs, commit messages when editing for the public package, and code comments.
- Comments: only non-obvious **why**. No narration of what the next line does.

## Naming and modules

- Filenames: **kebab-case**
- Components: **named function exports** (`export function Foo() {}`)
- Import alias: `#/*` → `src/*`

## TypeScript return types

Do **not** annotate return types on function or method **implementations**. Let TypeScript infer them.

```ts
// Prefer
export function transcriptsDir() {
  return join(homedir(), ".earpop", "transcripts");
}

// Avoid
export function transcriptsDir(): string {
  return join(homedir(), ".earpop", "transcripts");
}
```

**Keep** return annotations only when inference cannot express the contract:

- Type predicates: `value is SttRegion`
- Interface / type-alias members (the type definition itself)
- Rare cases such as some recursive helpers

## Function parameters

- **0–1** parameter: positional is fine.
- **2+** parameters: one **destructured object** in the parameter list (not a named `options` binding you unpack on the next line).

```ts
// Prefer
export async function saveApiKey({ key, region }: { key: string; region: SttRegion }) {
  // ...
}

// Avoid — extra `options` name
export async function saveApiKey(options: { key: string; region: SttRegion }) {
  const { key, region } = options;
  // ...
}

// Avoid — two positional args
export async function saveApiKey(key: string, region: SttRegion) {
  // ...
}
```

A named type is fine when the shape is shared: `({ key, region }: SaveApiKeyInput)`. React components keep a single `props` object (`function Foo(props: FooProps)`).

## Small helpers

A tiny pure helper is good when it has a clear name **and** more than one call site (or is the public surface of a module).

```ts
// OK — used from load / save / delete
function credentialsPath(region: SttRegion) {
  return join(homedir(), ".earpop", `credentials-${region}`);
}
```

Do **not** extract a helper that is only called once “for neatness.” Inline it at the call site instead.
