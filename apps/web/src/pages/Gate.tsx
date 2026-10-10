import { useState } from "react";
import { Eye, EyeOff, Lock } from "lucide-react";
import { connect, clientIdConfigured, lock, signOutEverywhere, unlock, useSession } from "../lib/session";
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
        Your private music player. Your songs live encrypted in your own Google Drive. Decryption happens only in this browser, so nothing
        ever leaves your Drive unencrypted.
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
      <p className="mt-6 text-xs text-white/40">Only files created by Spodrive are accessible (Drive "drive.file" scope).</p>
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

export function CheckingScreen() {
  return (
    <Frame>
      <p className="mt-6 flex items-center justify-center gap-2 text-sm text-white/70">
        <Spinner /> Looking for your Spodrive folder…
      </p>
    </Frame>
  );
}

export function NoRootScreen() {
  const retry = () => void connect();
  return (
    <Frame>
      <p className="mt-4 text-sm text-white/80">No Spodrive library was found in this Google account.</p>
      <p className="mt-3 text-sm text-white/70">
        Run <code className="rounded bg-white/10 px-1.5 py-0.5">npm run spodrive -- init</code> on your computer, then add music with{" "}
        <code className="rounded bg-white/10 px-1.5 py-0.5">npm run spodrive -- add &lt;folder&gt;</code>. Make sure you use the same Google account and the same
        Google Cloud project.
      </p>
      <div className="mt-6 flex justify-center gap-2">
        <Button onClick={retry}>Check again</Button>
        <Button variant="ghost" onClick={() => void signOutEverywhere()}>
          Use another account
        </Button>
      </div>
    </Frame>
  );
}

export function UnlockScreen() {
  const { busy, error } = useSession();
  const [pass, setPass] = useState("");
  const [show, setShow] = useState(false);
  return (
    <Frame>
      <div className="mt-3 flex items-center justify-center gap-2 text-sm text-white/70">
        <Lock size={14} /> Enter your passphrase to unlock your library
      </div>
      <form
        className="mt-6 space-y-3 text-left"
        onSubmit={(e) => {
          e.preventDefault();
          if (pass) void unlock(pass);
        }}
      >
        <div className="relative">
          <input
            type={show ? "text" : "password"}
            value={pass}
            onChange={(e) => setPass(e.target.value)}
            autoFocus
            autoComplete="current-password"
            placeholder="Passphrase"
            aria-label="Passphrase"
            aria-invalid={!!error}
            className="w-full rounded-lg bg-white/10 py-3 pl-4 pr-11 outline-none focus:bg-white/15"
          />
          <button
            type="button"
            aria-label={show ? "Hide passphrase" : "Show passphrase"}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-white/60 hover:text-white"
            onClick={() => setShow((s) => !s)}
          >
            {show ? <EyeOff size={18} /> : <Eye size={18} />}
          </button>
        </div>
        {error && (
          <p className="text-sm text-red-400" role="alert">
            {error}
          </p>
        )}
        <Button type="submit" className="w-full !py-3" disabled={busy || !pass}>
          {busy ? (
            <>
              <Spinner size={16} /> Unlocking…
            </>
          ) : (
            "Unlock"
          )}
        </Button>
      </form>
      <p className="mt-4 text-xs text-white/40">
        The derived key stays on this device as a non-extractable key until you press Lock in Settings.
      </p>
      <button className="mt-4 text-xs text-white/50 underline hover:text-white" onClick={() => void signOutEverywhere()}>
        Sign out
      </button>
    </Frame>
  );
}

export { lock };
