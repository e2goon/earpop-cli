# earpop-cli

Live speech-to-text in the terminal via Soniox realtime STT. Binary: `earpop`.

## Requirements

- **Node.js** 24+
- **macOS, Windows, or Linux** for live mic (`earpop-capture` optional dependency)
- **Soniox API key** — project region (`us` / `eu` / `jp`) must match the CLI region

## Install

```bash
npm i -g earpop-cli
# or: npx earpop / pnpm dlx earpop-cli
```

## Usage

```bash
earpop                       # live transcription
earpop settings              # mic + API key
earpop transcripts list
earpop transcripts view <id>
earpop transcripts export <id>
earpop auth clear
earpop --help
```

First run prompts for API key and microphone.

## Environment & storage

| Variable | Description |
| --- | --- |
| `SONIOX_API_KEY` | Wins over keychain/file |
| `SONIOX_REGION` | `us` \| `eu` \| `jp` (default `us`) |
| `EARPOP_CAPTURE_BIN` | Dev override path to capture binary (skips integrity) |
| `EARPOP_SKIP_CAPTURE_INTEGRITY` | `1` to skip SHA-256 checks |

API keys: macOS Keychain `com.earpop.app` / `soniox-api-key-<region>`; elsewhere `~/.earpop/credentials-<region>`.

Transcripts: macOS `~/Library/Application Support/com.earpop.app/transcripts/`; elsewhere `~/.earpop/transcripts/`.

Live mic uses a native sidecar; npm installs only the matching `earpop-capture-*` optional package. Transcript list/export and key storage work without it.

## License

MIT © wonmin

## Contributing

[AGENTS.md](./AGENTS.md) · [docs/CONVENTIONS.md](./docs/CONVENTIONS.md) · [docs/CONTRIBUTING.md](./docs/CONTRIBUTING.md) · [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md)
