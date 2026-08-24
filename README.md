# earpop-cli

Live speech-to-text in the terminal via Soniox realtime STT. The binary name is `earpop`.

## Requirements

- **Node.js** 24+ (Active LTS)
- **macOS** for live microphone capture (bundled `earpop-capture` helper; no ffmpeg)
- **Soniox API key** from [Soniox](https://soniox.com). The key’s project region (`us` / `eu` / `jp`) must match the CLI region.

## Install

```bash
npm i -g earpop-cli
```

One-shot:

```bash
npx earpop
# or
pnpm dlx earpop-cli
```

After install, use the `earpop` binary.

## Usage

```bash
earpop                       # start live transcription
earpop settings              # mic + API key settings
earpop transcripts list      # list recordings
earpop transcripts view <id> # print recording as txt to stdout
earpop transcripts export <id> # save recording as a txt file
earpop auth clear            # delete the saved API key for the current region
earpop --help                # help (-h / help also work)
```

On first run you are prompted for an API key and microphone. Change them anytime with `earpop settings`.

## Environment & storage

| Variable             | Description                                                                  |
| -------------------- | ---------------------------------------------------------------------------- |
| `SONIOX_API_KEY`     | API key. When set, **always wins** over keychain/file                        |
| `SONIOX_REGION`      | `us` \| `eu` \| `jp` (default `us`). Overrides `region` in the settings file |
| `EARPOP_CAPTURE_BIN` | Optional path to the capture sidecar (dev override)                          |

On macOS, API keys live in the Keychain:

- service: `com.earpop.app`
- account: `soniox-api-key-<region>` (e.g. `soniox-api-key-us`)

Elsewhere: `~/.earpop/credentials-<region>`.

Transcript files:

- macOS: `~/Library/Application Support/com.earpop.app/transcripts/`
- other: `~/.earpop/transcripts/`

## Platform notes

Live mic listing and capture use a bundled **cpal + rubato** sidecar (`earpop-capture`) on **macOS** (arm64 / x64). On Linux/Windows, listing/exporting transcripts and storing keys may work, but live mic capture is not supported yet.

## License

MIT © wonmin

## Contributing

- Users: this README.
- Agents: [AGENTS.md](./AGENTS.md).
- Code style: [docs/CONVENTIONS.md](./docs/CONVENTIONS.md).
- Commits / PRs: [docs/CONTRIBUTING.md](./docs/CONTRIBUTING.md).
- Design: [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md).
