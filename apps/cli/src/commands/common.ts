import { getAuthClient } from "../auth.js";
import { DriveStore } from "../drive.js";
import { getPassphrase } from "../prompt.js";
import { openSession, type Session } from "../vault.js";

/** Authenticate, open the Drive tree and unlock the vault. */
export async function openDriveSession(): Promise<Session> {
  const auth = await getAuthClient();
  const store = await DriveStore.open(auth);
  const pass = await getPassphrase();
  return openSession(store, pass);
}

export function formatBytes(n: number): string {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

export function formatDuration(sec: number): string {
  const s = Math.round(sec);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
