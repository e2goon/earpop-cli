# Architecture

**Goal:** minimize speech → on-screen text. Split **hot** and **cold**; React is a renderer only.

## Layers

```text
UI (ink)  ←── one snapshot / setState per WS message ──  transcription (outside React)
                                                         ├── audio (earpop-capture)
                                                         ├── soniox (ws)
                                                         ├── journal (JSONL)
                                                         └── api-key / settings
```

- **Hot:** mic → socket → tokens → UI — no blocking.
- **Cold:** journal, keepalive, settings — never stall hot.
- **Journal** owns full finals; UI keeps a short tail (flat render cost).
- Same controller modules power headless `transcripts` commands.

## Intentional STT / capture choices

- Provisional captions first; finals may lag. Endpoint detection **off** (accuracy over early finalize).
- `language_hints: ["ko","en"]` + strict hints; rolling final-text context on reconnect.
- Mic: cpal + rubato → 16 kHz mono; ~100ms (3200-byte) s16le frames; no ffmpeg.
- WS: `perMessageDeflate: false`; drop frames if `bufferedAmount` ≳ 5s audio; on reconnect keep capture, drop frames.
- One WS message → one snapshot → one UI update.

## Capture packaging (why)

Platform binaries ship as `optionalDependencies` (`earpop-capture-*`). Source of truth: `src/lib/capture-platforms.json` (keep Actions matrix aligned). Resolve / integrity / minimal spawn env: `capture-bin.ts`, `capture-integrity.json`, `capture-process.ts`. Release path: `pnpm release` → CI (`capture.yml`).

## Product shape

One meeting = one process = one JSONL. No daemon. macOS transcript/key paths share the desktop app support dir (`com.earpop.app`) so tools can read the same files; CLI settings file is `cli-settings.json` to avoid clashing with the desktop app.
