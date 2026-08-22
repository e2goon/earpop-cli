import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { exportText, listTranscripts } from "#/lib/transcripts.js";
import { transcriptsDir } from "#/lib/journal.js";

export async function runTranscriptsCommand({
  sub,
  id,
}: {
  sub: string | undefined;
  id: string | undefined;
}) {
  if (sub === "list") {
    const summaries = await listTranscripts();
    if (summaries.length === 0) {
      console.log("No saved transcripts.");
      return;
    }
    for (const summary of summaries) {
      console.log(`${summary.id}\t${summary.startedAt}\t${summary.tokenCount} tokens`);
    }
    return;
  }

  if ((sub === "view" || sub === "export") && id !== undefined) {
    const text = await exportText(id);
    if (sub === "view") {
      process.stdout.write(text);
      return;
    }
    const outPath = join(transcriptsDir(), `${id}.txt`);
    await writeFile(outPath, text);
    console.log(outPath);
    return;
  }

  console.error("Usage: earpop transcripts list | view <id> | export <id>");
  process.exitCode = 1;
}
