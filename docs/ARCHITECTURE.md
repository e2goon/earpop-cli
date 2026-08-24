# Architecture

Why this CLI is structured the way it is.

| Doc                                  | Role                                          |
| ------------------------------------ | --------------------------------------------- |
| [README.md](../README.md)            | Users and npm: install, usage, env, storage   |
| [AGENTS.md](../AGENTS.md)            | Agent workflow and tooling                    |
| [CONVENTIONS.md](./CONVENTIONS.md)   | Code style                                    |
| [CONTRIBUTING.md](./CONTRIBUTING.md) | Commits and pull requests                     |
| **This file**                        | Design intent, layers, latency, stack choices |

**Goal:** minimize time from speech to text on screen. Split **hot** and **cold** paths; keep React as a renderer only.

## Layers

```text
        ┌──────────────────────────────────────────────────────────────┐
        │  UI (ink + React) — screens/ + components/                   │
        │  caption: status + 4 caption lines + footer (+ overlays)     │
        │  key-setup / settings / microphone-select                    │
        └──────────────▲───────────────────────────────────────────────┘
                       │ one snapshot → setState per WS message
        ┌──────────────┴───────────────────────────────────────────────┐
        │  lib/transcription.ts (outside React)                        │
        │  session SM, reconnect backoff, caption tail, device switch  │
        └───▲──────────────▲──────────────────┬───────────────────────┘
            │ frames       │ tokens/state     │ final tokens
     ┌──────┴────────┐ ┌───┴───────┐ ┌────────▼─────┐ ┌────────────────┐
     │ lib/audio.ts  │ │lib/soniox │ │lib/journal.ts│ │ api-key /      │
     │ earpop-capture│ │ ws        │ │ JSONL append │ │ settings       │
     └──────▲────────┘ └────▲──────┘ └───────▲──────┘ └───────▲────────┘
         mic            Soniox          transcripts/      keychain, etc.
```

Principles:

- **Hot path:** mic → socket → tokens → UI — no blocking waits.
- **Cold path:** journal, keepalive, settings — never stall the hot path.
- **React draws only.** Audio/WS/files live in the controller; same modules work without UI (`transcripts` commands).
- **Single source of history:** journal owns full finals; UI holds a short **tail** so render cost stays flat.

## Latency budget

| Stage              | Latency    | Choice                                              |
| ------------------ | ---------- | --------------------------------------------------- |
| Mic → capture out  | ~100ms     | cpal+rubato sidecar; 3200-byte (100ms) s16le frames |
| Frame → socket     | ~0         | send as soon as a frame fills; no batching          |
| Socket             | tens of ms | `perMessageDeflate: false`                          |
| Soniox provisional | 200–400ms  | server-side                                         |
| Token → UI         | immediate  | token events paint without coalesce                 |

Provisional captions are the priority; finals may arrive later.
Endpoint detection stays off so early finalization does not trade away word/diarization accuracy.
Korean-primary bias: `language_hints: ["ko","en"]` + `language_hints_strict`, plus `context.general`
and a rolling final-text tail on reconnect (same idea as desktop).
Mic path matches desktop quality: **cpal + rubato FFT** resample to 16 kHz (not ffmpeg).

## Data flow

```text
[hot]
earpop-capture stdout ──3200B──▶ transcription ──sendAudio──▶ ws
ws ──token JSON──▶ transcription ──snapshot──▶ caption (1× setState)

[cold]
transcription ──finals──▶ journal append
soniox ──keepalive every 10s──▶ ws
transcription ──errors──▶ reconnect backoff (1s→30s; reset after 30s stable)
transcription ──device change──▶ restart capture only (session kept) + journal session line + settings
```

Controller rules:

- If `bufferedAmount` > ~5s of audio (160KB), drop frames (stale audio).
- During reconnect, keep capture up and drop frames (cheaper than restarting the mic).
- One WS message → one snapshot → one UI update.

## Live session lifecycle

```text
earpop
  → resolve API key (else key-setup)
  → resolve mic (else microphone-select)
  → open journal → start capture + session → caption
        m: mic overlay → restart capture only + session line + save settings
        p: pause/resume (stop capture+session; elapsed excludes pause)
  ESC → stop capture → session stop (empty frame → finished, 3s grace)
        → show transcript path (clipboard) and wait
  ESC again → unmount → print transcript path → exit 0
  Ctrl+C follows the same two-step exit
```

One meeting = one process = one JSONL file. No daemon. Agents consume finished files via `earpop transcripts list|view|export`.

## Persistence (design)

Storage locations for users are documented in the README. Architecturally:

- Transcript JSONL shares the desktop app folder on macOS (`com.earpop.app`) so tools can read the same files.
- API keys are **per region** (`us` / `eu` / `jp`); env `SONIOX_API_KEY` / `SONIOX_REGION` override stored values.
- CLI settings use `cli-settings.json` in the same support directory (name chosen not to clash with the desktop app).

## Stack choices (locked)

| Role     | Choice                                                                              |
| -------- | ----------------------------------------------------------------------------------- |
| Runtime  | Node.js **24+** (Active LTS); matches `engines` and ink 7                           |
| Package  | pnpm; `prepublishOnly` builds macOS + Windows + Linux capture binaries + `tsup`     |
| UI       | ink 7 + @inkjs/ui, React 19                                                         |
| WS       | `ws` (deflate off, `bufferedAmount`, binary control)                                |
| Mic      | Rust sidecar `earpop-capture` (cpal + rubato); macOS / Windows / Linux in `vendor/` |
| CLI args | raw `process.argv` (few commands)                                                   |
| Bundle   | tsup ESM + shebang → `dist/index.js`; npm `files`: **`dist`** + **`vendor`**        |

Runtime deps: ink, @inkjs/ui, react, ws.
