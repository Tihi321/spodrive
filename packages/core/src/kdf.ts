import { openBlob, sealBlob } from "./blob";
import { bs, fromBase64, randomBytes, toBase64, utf8Decode, utf8Encode } from "./bytes";

export const DEFAULT_ITERATIONS = 600_000;
const CHECK_PLAINTEXT = "spodrive-vault-check-v1";

export interface VaultFile {
  format: "spodrive-vault";
  version: 1;
  kdf: { name: "PBKDF2-SHA256"; iterations: number; salt: string };
  /** base64 of an SPB1 blob encrypting a known constant with the KEK. */
  check: string;
}

export class WrongPassphraseError extends Error {
  constructor() {
    super("Wrong passphrase");
    this.name = "WrongPassphraseError";
  }
}

export async function deriveKek(
  passphrase: string,
  salt: Uint8Array,
  iterations = DEFAULT_ITERATIONS,
  extractable = false,
): Promise<CryptoKey> {
  const subtle = globalThis.crypto.subtle;
  const base = await subtle.importKey("raw", bs(utf8Encode(passphrase.normalize("NFKC"))), "PBKDF2", false, ["deriveKey"]);
  return subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt: bs(salt), iterations },
    base,
    { name: "AES-GCM", length: 256 },
    extractable,
    ["encrypt", "decrypt"],
  );
}

export async function createVault(
  passphrase: string,
  iterations = DEFAULT_ITERATIONS,
  extractable = false,
): Promise<{ vault: VaultFile; kek: CryptoKey }> {
  const salt = randomBytes(16);
  const kek = await deriveKek(passphrase, salt, iterations, extractable);
  const check = await sealBlob(kek, utf8Encode(CHECK_PLAINTEXT));
  return {
    vault: {
      format: "spodrive-vault",
      version: 1,
      kdf: { name: "PBKDF2-SHA256", iterations, salt: toBase64(salt) },
      check: toBase64(check),
    },
    kek,
  };
}

export async function unlockVault(vault: VaultFile, passphrase: string, extractable = false): Promise<CryptoKey> {
  if (vault.format !== "spodrive-vault" || vault.version !== 1) throw new Error("Unsupported vault file");
  const kek = await deriveKek(passphrase, fromBase64(vault.kdf.salt), vault.kdf.iterations, extractable);
  try {
    const pt = utf8Decode(await openBlob(kek, fromBase64(vault.check)));
    if (pt !== CHECK_PLAINTEXT) throw new WrongPassphraseError();
  } catch {
    throw new WrongPassphraseError();
  }
  return kek;
}
