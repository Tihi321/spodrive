import { useRef, useState } from "react";
import { FileText } from "lucide-react";
import { useLibrary } from "../lib/library";
import { matchLrcFiles, readLyricsFile, summarizeImport } from "../lib/lyrics-import";
import { loadUserLyricsIndex, saveUserLyrics } from "../lib/user-lyrics";
import { toast, toastError } from "../state/toasts";
import { Button } from "./bits";

/** Settings button: pick .lrc files, match them to library tracks by tags / file name, save them to Drive. */
export function ImportLyricsButton() {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const run = async (picked: File[]) => {
    const tracks = useLibrary.getState().library?.tracks ?? [];
    setBusy(true);
    try {
      const files = await Promise.all(picked.map(async (f) => ({ name: f.name, text: await readLyricsFile(f) })));
      const result = matchLrcFiles(files, tracks);
      const failed: string[] = [];
      let saved = 0;
      await loadUserLyricsIndex(true);
      for (const m of result.matches) {
        try {
          await saveUserLyrics(m.trackId, m.text);
          saved++;
        } catch {
          failed.push(m.name);
        }
      }
      const problems = result.matches.length < files.length || failed.length > 0;
      toast(summarizeImport(saved, result, failed), { kind: saved && !problems ? "success" : "info", durationMs: problems ? 10000 : undefined });
    } catch (e) {
      toastError(e, "Could not import lyrics");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <input
        ref={input}
        type="file"
        accept=".lrc,.txt"
        multiple
        hidden
        onChange={(e) => {
          const picked = Array.from(e.target.files ?? []);
          e.target.value = ""; // allow picking the same files again
          if (picked.length) void run(picked);
        }}
      />
      <Button variant="ghost" disabled={busy} onClick={() => input.current?.click()}>
        <FileText size={18} />
        {busy ? "Importing…" : "Import lyrics files (.lrc)"}
      </Button>
    </>
  );
}
