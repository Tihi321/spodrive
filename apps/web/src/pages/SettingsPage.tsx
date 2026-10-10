import { useEffect, useState, type ReactNode } from "react";
import { Lock, LogOut, Trash2 } from "lucide-react";
import { encryptedSize } from "@spodrive/core";
import pkg from "../../package.json";
import { useAuth } from "../lib/auth";
import { useLibrary } from "../lib/library";
import { removeAllDownloads, storageEstimate, useOffline } from "../lib/offline";
import { lock, signOutEverywhere } from "../lib/session";
import { useSettings } from "../state/settings";
import { toast, toastError } from "../state/toasts";
import { Button, cx } from "../ui/bits";
import { ConfirmSheet } from "../ui/PromptSheet";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-2xl bg-surface p-4">
      <h2 className="mb-3 text-sm font-bold uppercase tracking-wider text-muted">{title}</h2>
      <div className="space-y-4">{children}</div>
    </section>
  );
}

function Toggle({ label, desc, checked, onChange }: { label: string; desc?: ReactNode; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-4">
      <span>
        <span className="block text-[15px] font-medium">{label}</span>
        {desc && <span className="mt-0.5 block text-xs text-muted">{desc}</span>}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={cx("relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition", checked ? "bg-accent" : "bg-white/20")}
      >
        <span className={cx("absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all", checked ? "left-[22px]" : "left-0.5")} />
      </button>
    </label>
  );
}

const fmtBytes = (n: number | undefined) => {
  if (n === undefined) return "unknown";
  const u = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(n >= 10 || i === 0 ? 0 : 1)} ${u[i]}`;
};

export function SettingsPage() {
  const settings = useSettings();
  const user = useAuth((s) => s.user);
  const downloaded = useOffline((s) => s.downloaded);
  const index = useLibrary((s) => s.index);
  const [est, setEst] = useState<{ usage?: number; quota?: number }>({});
  const [confirm, setConfirm] = useState<null | "downloads" | "signout">(null);

  useEffect(() => {
    void storageEstimate().then(setEst);
  }, [downloaded]);

  const downloadedBytes = [...downloaded].reduce((sum, id) => {
    const t = index?.byId.get(id);
    return sum + (t ? encryptedSize(t.plainSize, t.chunkSize) : 0);
  }, 0);

  return (
    <div className="mx-auto max-w-2xl space-y-4 p-4 pb-10">
      <h1 className="pt-2 text-2xl font-bold">Settings</h1>

      <Section title="Account">
        <div className="text-sm">
          {user?.email ? (
            <>
              Signed in as <span className="font-semibold">{user.email}</span>
            </>
          ) : (
            "Signed in with Google"
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="ghost"
            onClick={() => {
              void lock().then(() => toast("Locked. Your key was wiped from this device."));
            }}
          >
            <Lock size={16} /> Lock
          </Button>
          <Button variant="danger" onClick={() => setConfirm("signout")}>
            <LogOut size={16} /> Sign out
          </Button>
        </div>
        <p className="text-xs text-muted">
          Lock wipes the decryption key and everything decrypted from memory; you will need your passphrase again. Sign out also revokes Google access and clears all data stored on this device.
        </p>
      </Section>

      <Section title="Playback">
        <Toggle
          label="Prefetch next track"
          desc="Download the next track in the background near the end of the current one, so it starts instantly (also helps with the screen locked)."
          checked={settings.prefetchEnabled}
          onChange={(v) => settings.set("prefetchEnabled", v)}
        />
      </Section>

      <Section title="Lyrics">
        <Toggle
          label="Fetch lyrics from lrclib.net"
          desc="Privacy: when on, the title, artist, album and duration of the tracks you play are sent to lrclib.net in plain text to look up lyrics. Turn off for full privacy; nothing else ever leaves your device unencrypted."
          checked={settings.lyricsEnabled}
          onChange={(v) => settings.set("lyricsEnabled", v)}
        />
      </Section>

      <Section title="Downloads">
        <div className="text-sm">
          <div>
            {downloaded.size} {downloaded.size === 1 ? "track" : "tracks"} downloaded ({fmtBytes(downloadedBytes)})
          </div>
          <div className="text-xs text-muted">
            Browser storage in use: {fmtBytes(est.usage)} of {fmtBytes(est.quota)} available
          </div>
        </div>
        <Button variant="danger" disabled={downloaded.size === 0 && !est.usage} onClick={() => setConfirm("downloads")}>
          <Trash2 size={16} /> Remove all downloads
        </Button>
        <p className="text-xs text-muted">Downloads are stored encrypted, exactly as they are on Drive.</p>
      </Section>

      <Section title="About">
        <p className="text-sm">
          Spodrive <span className="text-muted">v{pkg.version}</span>
        </p>
        <p className="text-xs text-muted">
          Private player for encrypted music on your Google Drive. Decryption happens only in this browser. Library: {index?.tracks.length ?? 0} tracks.
        </p>
      </Section>

      {confirm === "downloads" && (
        <ConfirmSheet
          title="Remove all downloads?"
          message="Downloaded and prefetched tracks will be deleted from this device. They stay on Drive."
          confirmLabel="Remove"
          onClose={() => setConfirm(null)}
          onConfirm={() => void removeAllDownloads().then(() => toast("Downloads removed")).catch((e) => toastError(e))}
        />
      )}
      {confirm === "signout" && (
        <ConfirmSheet
          title="Sign out?"
          message="This revokes Google access and deletes the key, caches and downloads from this device."
          confirmLabel="Sign out"
          onClose={() => setConfirm(null)}
          onConfirm={() => void signOutEverywhere()}
        />
      )}
    </div>
  );
}
