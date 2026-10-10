import password from "@inquirer/password";
import confirm from "@inquirer/confirm";

/** Passphrase from SPODRIVE_PASSPHRASE (scripting) or a hidden prompt. */
export async function getPassphrase(message = "Passphrase", opts: { confirm?: boolean } = {}): Promise<string> {
  const env = process.env.SPODRIVE_PASSPHRASE;
  if (env) return env;
  const first = await password({ message, mask: "*" });
  if (!first) throw new Error("Empty passphrase");
  if (opts.confirm) {
    const second = await password({ message: "Confirm passphrase", mask: "*" });
    if (first !== second) throw new Error("Passphrases do not match");
  }
  return first;
}

/** New passphrase for passwd: SPODRIVE_NEW_PASSPHRASE or a confirmed prompt. */
export async function getNewPassphrase(): Promise<string> {
  const env = process.env.SPODRIVE_NEW_PASSPHRASE;
  if (env) return env;
  const first = await password({ message: "New passphrase", mask: "*" });
  if (!first) throw new Error("Empty passphrase");
  const second = await password({ message: "Confirm new passphrase", mask: "*" });
  if (first !== second) throw new Error("Passphrases do not match");
  return first;
}

/** Yes/no prompt; SPODRIVE_YES=1 auto-confirms (scripting). */
export async function askConfirm(message: string, def = false): Promise<boolean> {
  if (process.env.SPODRIVE_YES) return true;
  return confirm({ message, default: def });
}

/** PBKDF2 iterations used when creating a vault (env override for tests). */
export function kdfIterations(): number | undefined {
  const v = process.env.SPODRIVE_KDF_ITERATIONS;
  if (!v) return undefined;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1) throw new Error("SPODRIVE_KDF_ITERATIONS must be a positive integer");
  return n;
}
