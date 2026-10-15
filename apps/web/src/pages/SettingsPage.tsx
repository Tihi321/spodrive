import { useEffect, useState, type ReactNode } from "react";
import { FileAudio, Folder, KeyRound, LogOut, Plus, RefreshCw, Trash2 } from "lucide-react";
import pkg from "../../package.json";
import { reconnect, useAuth } from "../lib/auth";
import { useLibrary } from "../lib/library";
import { addMusic, removeSourceById, rescan, useScan } from "../lib/library-actions";
import { removeAllDownloads, storageEstimate, useOffline } from "../lib/offline";
import { signOutEverywhere } from "../lib/session";
import { useSettings } from "../state/settings";
import { toast, toastError } from "../state/toasts";
import { Button, Spinner, cx } from "../ui/bits";
import { ConfirmSheet } from "../ui/PromptSheet";

/** Whether Google access renews by itself, with a way to switch an hourly session to a lasting one. */
function SessionInfo() {
  const persistent = useAuth((s) => s.persistent);
  const serverAvailable = useAuth((s) => s.serverAvailable);
  if (persistent) return <p className="text-sm text-white/80">You stay signed in on this device, also when the screen is off.</p>;
  if (!serverAvailable) {
    return <p className="text-sm text-white/80">Google access lasts an hour at a time. Tap Reconnect when the app asks.</p>;
  }
  return (
    <div className="space-y-2">
      <p className="text-sm text-white/80">Google access on this device lasts an hour at a time. Sign in once more to stay signed in.</p>
      <Button
        variant="ghost"
        onClick={() =>
          void reconnect().then((ok) => {
            if (ok && useAuth.getState().persistent) toast("You'll stay signed in on this device", { kind: "success" });
          })
        }
      >
        <KeyRound size={16} /> Stay signed in
      </Button>
    </div>
  );
}

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
  const library = useLibrary((s) => s.library);
  const scan = useScan();
  const [est, setEst] = useState<{ usage?: number; quota?: number }>({});
  const [confirm, setConfirm] = useState<null | "downloads" | "signout" | { source: string }>(null);

  useEffect(() => {
    void storageEstimate().then(setEst);
  }, [downloaded]);

  const downloadedBytes = [...downloaded].reduce((sum, id) => {
    const t = index?.byId.get(id);
    return sum + (t?.size ?? 0);
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
          <Button variant="danger" onClick={() => setConfirm("signout")}>
            <LogOut size={16} /> Sign out
          </Button>
        </div>
        <SessionInfo />
        <p className="text-xs text-muted">
          Sign out revokes Google access and clears all data stored on this device. Your files in Drive are never changed.
        </p>
      </Section>

      <Section title="Library">
        <div className="text-sm">
          {index?.tracks.length ?? 0} tracks from {library?.sources.length ?? 0} {library?.sources.length === 1 ? "source" : "sources"}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button disabled={scan.running} onClick={() => void addMusic()}>
            <Plus size={16} /> Add or upload music
          </Button>
          <Button
            variant="ghost"
            disabled={scan.running || !library?.sources.some((s) => s.kind === "folder")}
            onClick={() => void rescan()}
          >
            <RefreshCw size={16} /> Rescan folders
          </Button>
        </div>
        {scan.running && (
          <div className="flex items-center gap-2 text-sm text-muted" role="status">
            <Spinner size={14} /> {scan.label}: {scan.progress.done} of {scan.progress.total}
            {scan.progress.failed > 0 && ` (${scan.progress.failed} failed)`}
          </div>
        )}
        {library && library.sources.length > 0 && (
          <ul className="divide-y divide-white/10">
            {library.sources.map((s) => (
              <li key={s.id} className="flex items-center gap-3 py-2">
                <span className="text-white/50">{s.kind === "folder" ? <Folder size={18} /> : <FileAudio size={18} />}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm">{s.name}</span>
                  <span className="block text-xs text-muted">
                    {library.tracks.filter((t) => t.sourceId === s.id).length} tracks
                  </span>
                </span>
                {s.kind === "folder" && (
                  <Button variant="ghost" className="!px-3 !py-1.5" disabled={scan.running} onClick={() => void rescan(s.id)}>
                    Rescan
                  </Button>
                )}
                <Button variant="ghost" className="!px-3 !py-1.5" disabled={scan.running} onClick={() => setConfirm({ source: s.id })}>
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        )}
        <p className="text-xs text-muted">
          Spodrive only reads the files you pick and never changes them. The list of tracks is saved in a Spodrive folder in your Drive so it syncs between your devices.
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
          desc="Privacy: when on, the title, artist, album and duration of the tracks you play are sent to lrclib.net in plain text to look up lyrics. Turn off to keep this private."
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
        <p className="text-xs text-muted">Downloads are kept in this browser so tracks play offline. They stay on Drive too.</p>
      </Section>

      <Section title="About">
        <p className="text-sm">
          Spodrive <span className="text-muted">v{pkg.version}</span>
        </p>
        <p className="text-xs text-muted">
          Music player for your Google Drive; your music streams straight from Drive. Library: {index?.tracks.length ?? 0} tracks.
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
      {typeof confirm === "object" && confirm && (
        <ConfirmSheet
          title="Remove from library?"
          message="The songs disappear from Spodrive. The files in your Drive are not touched; you can add them again any time."
          confirmLabel="Remove"
          onClose={() => setConfirm(null)}
          onConfirm={() => void removeSourceById(confirm.source).catch((e) => toastError(e))}
        />
      )}
      {confirm === "signout" && (
        <ConfirmSheet
          title="Sign out?"
          message="This revokes Google access and deletes the library cache and downloads from this device."
          confirmLabel="Sign out"
          onClose={() => setConfirm(null)}
          onConfirm={() => void signOutEverywhere()}
        />
      )}
    </div>
  );
}
