# earpop-cli

Real-time speech-to-text in the terminal, using [Soniox](https://soniox.com). Captions show up while people are still talking, tagged by speaker, and every session is saved as a transcript you can export later.

## Requirements

- Node.js 24 or newer
- A Soniox API key from the [Soniox Console](https://console.soniox.com). Soniox projects belong to a region (US, EU, or Japan), and earpop has to be set to the same one.
- For live transcription: macOS (Apple Silicon or Intel), Windows x64, or Linux x64/arm64 with ALSA. On other platforms the transcript and API key commands still work.

## Install

```bash
npm i -g earpop-cli
```

To try it without installing, run `npx earpop-cli`.

npm only installs the microphone helper for your platform (one of the `earpop-capture-*` packages). Before each session, earpop checks the helper's SHA-256 hash against the one recorded at release.

## Getting started

Run `earpop`. The first time, it asks for your Soniox region and API key, verifies the key with Soniox, and then asks you to pick a microphone. After that it goes straight to captions.

Language hints default to English. Press `s` and choose "Choose languages" to change them. Pick one language to keep the output in that language, or several for a mixed conversation.

## Live screen

```text
● Listening                                                     03:12
[S1] So the plan is to ship the beta on Friday.
[S2] Does that include the Windows build?
[S1] Yes, the capture helper is ready for x64.
p pause · 1-9 speaker · 0 all · m mic · s settings · ESC end
```

Dimmed text is provisional and gets replaced once Soniox finalizes it. Only the last six lines fit on screen; everything goes into the transcript file.

| Key        | Action                                                                                              |
| ---------- | --------------------------------------------------------------------------------------------------- |
| `p`        | Pause or resume. Pausing also copies the transcript path to the clipboard.                          |
| `1` to `9` | Show only that speaker. Press more numbers to add speakers, or the same number again to remove one. |
| `0`        | Show everyone again                                                                                 |
| `m`        | Switch microphone                                                                                   |
| `s`        | Settings                                                                                            |
| `ESC`      | End the session, then press again to quit                                                           |

`Ctrl+C` does the same as `ESC`. If quitting gets stuck, press it once more to force it.

When you quit, earpop prints the transcript path and copies it to the clipboard.

## Settings

`earpop settings`, or `s` during a session, lets you change the microphone, languages, region, and API key. Microphone and language changes apply right away. Region and key changes apply the next time you run earpop. Each region has its own saved key.

`earpop auth clear` deletes the saved key for the current region.

## Transcripts

Each session is a JSONL file named after its start time, such as `2026-10-12_14-03-27.jsonl`. Final text is appended as it arrives, with timestamps, speaker, and language for every token.

```bash
earpop transcripts list           # newest first
earpop transcripts view <id>      # print as plain text
earpop transcripts export <id>    # write <id>.txt next to the JSONL file
```

The plain text version starts a new paragraph when the speaker changes or after more than two seconds without speech:

```text
earpop transcript v1
id: 2026-10-12_14-03-27
started: 2026-10-12T14:03:27+09:00
model: stt-rt-v5

[00:00] S1: So the plan is to ship the beta on Friday.
[00:04] S2: Does that include the Windows build?
```

## Environment variables

| Variable                        | Description                                                              |
| ------------------------------- | ------------------------------------------------------------------------ |
| `SONIOX_API_KEY`                | Used instead of the saved key                                            |
| `SONIOX_REGION`                 | `us`, `eu`, or `jp`. Used instead of the saved region. Defaults to `us`. |
| `EARPOP_CAPTURE_BIN`            | Path to a capture helper you built yourself. Skips the hash check.       |
| `EARPOP_SKIP_CAPTURE_INTEGRITY` | Set to `1` to skip the hash check. Only for local builds.                |

## Files

|             | macOS                                                                 | Windows and Linux                |
| ----------- | --------------------------------------------------------------------- | -------------------------------- |
| API key     | Keychain, service `com.earpop.app`, account `soniox-api-key-<region>` | `~/.earpop/credentials-<region>` |
| Settings    | `~/Library/Application Support/com.earpop.app/cli-settings.json`      | `~/.earpop/cli-settings.json`    |
| Transcripts | `~/Library/Application Support/com.earpop.app/transcripts/`           | `~/.earpop/transcripts/`         |

Audio goes to the Soniox endpoint for your region and is never written to disk.

## Troubleshooting

If Soniox rejects your key, the region is usually wrong. Run `earpop settings`, change the region, and enter the key again.

If you see "Capture helper integrity check failed", the helper doesn't match the released build. Reinstall earpop-cli.

On Linux, live transcription needs ALSA (`libasound2`) and access to the audio device. Copying to the clipboard uses `wl-copy`, `xclip`, or `xsel`; without any of them earpop falls back to OSC 52, which not every terminal supports.

## Contributing

See [AGENTS.md](./AGENTS.md), [docs/CONVENTIONS.md](./docs/CONVENTIONS.md), [docs/CONTRIBUTING.md](./docs/CONTRIBUTING.md), and [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md).

## License

MIT © wonmin
