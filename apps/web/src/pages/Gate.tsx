import { connect, clientIdConfigured, useSession } from "../lib/session";
import { Button, Spinner } from "../ui/bits";

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div className="pt-safe pb-safe flex min-h-dvh items-center justify-center bg-[radial-gradient(ellipse_at_top,#12301f_0%,#0b0b0c_60%)] px-6 py-10">
      <div className="fade-in w-full max-w-sm text-center">
        <img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" className="mx-auto h-20 w-20" />
        <h1 className="mt-4 text-3xl font-extrabold tracking-tight">Spodrive</h1>
        {children}
      </div>
    </div>
  );
}

export function Splash() {
  return (
    <Frame>
      <div className="mt-8 flex justify-center">
        <Spinner size={28} />
      </div>
    </Frame>
  );
}

export function ConnectScreen() {
  const { busy, error } = useSession();
  const configured = clientIdConfigured();
  return (
    <Frame>
      <p className="mt-3 text-sm text-white/70">
        Your music player for Google Drive. Pick songs and folders from your own Drive, or upload them from this device, and play them here. There is no server in
        between: your browser talks to Google directly.
      </p>
      {configured ? (
        <Button className="mt-8 w-full !py-3 text-base" disabled={busy} onClick={() => void connect()}>
          {busy ? <Spinner size={16} /> : <GoogleG />} Sign in with Google
        </Button>
      ) : (
        <div className="mt-8 rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-left text-sm text-amber-100" role="alert">
          <p className="font-semibold">Google client ID is not configured</p>
          <p className="mt-1 text-amber-100/80">
            Create an OAuth <em>Web</em> client in Google Cloud Console, then set <code className="rounded bg-black/30 px-1">VITE_GOOGLE_CLIENT_ID</code>{" "}
            in <code className="rounded bg-black/30 px-1">apps/web/.env</code> (see <code className="rounded bg-black/30 px-1">.env.example</code>) and
            restart the dev server. Add this page's origin to the client's authorized JavaScript origins.
          </p>
        </div>
      )}
      {error && (
        <p className="mt-4 text-sm text-red-400" role="alert">
          {error}
        </p>
      )}
      <p className="mt-6 text-xs text-white/40">Spodrive can only access the files you pick (Drive "drive.file" scope).</p>
    </Frame>
  );
}

function GoogleG() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden>
      <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.1C12.4 13.6 17.7 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.5 5.8c4.4-4.1 7.1-10.1 7.1-17.5z" />
      <path fill="#FBBC05" d="M10.5 28.7c-.5-1.4-.8-3-.8-4.7s.3-3.2.8-4.7l-7.9-6.1C.9 16.4 0 20.1 0 24s.9 7.6 2.6 10.8l7.9-6.1z" />
      <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.5-5.8c-2.1 1.4-4.9 2.3-8.4 2.3-6.3 0-11.6-4.1-13.5-9.8l-7.9 6.1C6.5 42.6 14.6 48 24 48z" />
    </svg>
  );
}
