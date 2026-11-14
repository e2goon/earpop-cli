import { writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";

import { transcriptPath } from "#/lib/journal.js";
import {
  isTranscriptFormat,
  renderTranscript,
  TRANSCRIPT_FORMATS,
} from "#/lib/transcript-formats.js";
import { listTranscripts, readTranscript, resolveTranscriptId } from "#/lib/transcripts.js";

const USAGE = `Usage: earpop transcripts list
       earpop transcripts view <id|latest> [--format ${TRANSCRIPT_FORMATS.join("|")}]
       earpop transcripts export <id|latest> [--format ${TRANSCRIPT_FORMATS.join("|")}] [--out <path>]`;

export async function runTranscriptsCommand(args: string[]) {
  let parsed;
  try {
    parsed = parseArgs({
      args,
      allowPositionals: true,
      options: {
        format: { type: "string", short: "f", default: "txt" },
        out: { type: "string", short: "o" },
      },
    });
  } catch (error) {
    throw new Error(`${error instanceof Error ? error.message : String(error)}\n${USAGE}`);
  }
  const [sub, rawId] = parsed.positionals;
  const { format, out } = parsed.values;

  if (sub === "list") {
    const summaries = await listTranscripts();
    if (summaries.length === 0) {
      console.log("No saved transcripts.");
      return;
    }
    for (const summary of summaries) {
      console.log(`${summary.id}\t${summary.startedAt}\t${summary.duration}`);
    }
    return;
  }

  if ((sub === "view" || sub === "export") && rawId !== undefined) {
    if (!isTranscriptFormat(format)) {
      throw new Error(`Unknown format: ${format}. Use one of ${TRANSCRIPT_FORMATS.join(", ")}.`);
    }
    const id = await resolveTranscriptId(rawId);
    const text = renderTranscript({ id, transcript: await readTranscript(id), format });
    if (sub === "view") {
      process.stdout.write(text);
      return;
    }
    const outPath = out ?? transcriptPath(id).replace(/\.jsonl$/, `.${format}`);
    await writeFile(outPath, text);
    console.log(outPath);
    return;
  }

  console.error(USAGE);
  process.exitCode = 1;
}
