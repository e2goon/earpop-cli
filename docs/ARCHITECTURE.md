# Architecture

**Goal:** minimize the time from speech to on-screen text. Split **hot** and **cold**; React is a renderer only.

## Layers

```text
UI (ink)  ←── one snapshot / setState per WS message ──  transcription (outside React)
                                                         ├── audio (earpop-capture)
                                                         ├── soniox (ws)
                                                         ├── journal (JSONL)
                                                         └── api-key / settings
```

- **Hot:** mic, socket, tokens, UI; no blocking.
- **Cold:** journal, keepalive, settings — never stall hot.
- **Journal** persists full finals; the controller also keeps them in memory for history scrollback. Live captions lay out only the tail that fits the terminal (cost bounded by screen size, not session length), and history renders only the visible rows.
- The published bundle runs React and Ink in production mode (`src/production.ts`); `pnpm dev` keeps development builds.
- Same controller modules power headless `transcripts` commands.

## Intentional STT / capture choices

- Provisional captions first; finals may lag. Endpoint detection **off** (accuracy over early finalize).
- Language hints from settings, asked on first run (the suggestion is the system language plus English); strict when a single language is selected; two-way translation adds both languages to the hints; rolling final-text context (speech only, not translations) on reconnect.
- Language identification is always on: captions and exports split lines on language changes.
- Translations arrive after the speech they translate and carry no timestamps; the journal files them at the end of that speech and exports show them over it.
- Mic: cpal + rubato resample to 16 kHz mono; ~100ms (3200-byte) s16le frames; no ffmpeg.
- WS: key in the `Authorization` header; `perMessageDeflate: false`; drop frames if `bufferedAmount` ≳ 5s audio; on reconnect keep capture, drop frames.
- Errors 400/401/402/403 are fatal; others reconnect with backoff.
- No microphone, no session: losing the microphone closes the Soniox session, since open sessions may be billed without audio.
- Stalled capture (no frames for 3 s, as Bluetooth devices do when switching to their microphone profile) is reopened with a fresh session so timestamps stay aligned; three tries per minute, then the user is asked to pick another microphone.
- The capture helper exits when its parent process changes, so a killed CLI never leaves the microphone open.
- One WS message, one snapshot, one UI update.

## Capture packaging (why)

Platform binaries ship as `optionalDependencies` (`earpop-capture-*`). Source of truth: `src/lib/capture-platforms.json` (keep Actions matrix aligned). Resolve / integrity / minimal spawn env: `capture-bin.ts`, `capture-integrity.json`, `capture-process.ts`. Release path: `pnpm release`, then CI (`capture.yml`).

## Product shape

One meeting = one process = one JSONL. No daemon. macOS transcript/key paths share the desktop app support dir (`com.earpop.app`) so tools can read the same files; CLI settings file is `cli-settings.json` to avoid clashing with the desktop app.
