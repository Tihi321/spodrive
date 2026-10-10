import { getAuthClient } from "../auth.js";
import { DriveStore } from "../drive.js";
import { getPassphrase } from "../prompt.js";
import { initVault } from "../vault.js";

export async function runInit(opts: { force?: boolean }): Promise<void> {
  const auth = await getAuthClient();
  const existing = await DriveStore.findRoots(auth);
  if (existing.length > 0 && !opts.force) {
    throw new Error(
      `A Spodrive folder already exists (id ${existing[0]?.id}). Refusing to init again; use --force to create a ` +
        `second, separate tree (existing data is never deleted).`,
    );
  }
  const pass = await getPassphrase("Choose a passphrase", { confirm: true });
  const store = await DriveStore.create(auth);
  await initVault(store, pass);
  console.log(`Created Spodrive folder tree (root id ${store.rootId}).`);
  console.log("Remember your passphrase: it cannot be recovered.");
}
