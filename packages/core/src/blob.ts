import { bs, concat, fromBase64, randomBytes, utf8Decode, utf8Encode } from "./bytes";

/** Single-shot blob: "SPB1" (4) | IV (12) | AES-GCM ciphertext+tag. */
export const BLOB_MAGIC = utf8Encode("SPB1");
const IV_LEN = 12;

export class BlobFormatError extends Error {
  constructor(msg = "Invalid blob") {
    super(msg);
    this.name = "BlobFormatError";
  }
}

const subtle = () => globalThis.crypto.subtle;

export async function sealBlob(key: CryptoKey, plaintext: Uint8Array, aad?: Uint8Array): Promise<Uint8Array> {
  const iv = randomBytes(IV_LEN);
  const params: AesGcmParams = { name: "AES-GCM", iv: bs(iv) };
  if (aad) params.additionalData = bs(aad);
  const ct = new Uint8Array(await subtle().encrypt(params, key, bs(plaintext)));
  return concat(BLOB_MAGIC, iv, ct);
}

export async function openBlob(key: CryptoKey, data: Uint8Array, aad?: Uint8Array): Promise<Uint8Array> {
  if (data.length < 4 + IV_LEN + 16) throw new BlobFormatError("Blob too short");
  for (let i = 0; i < 4; i++) if (data[i] !== BLOB_MAGIC[i]) throw new BlobFormatError("Bad blob magic");
  const iv = data.subarray(4, 4 + IV_LEN);
  const params: AesGcmParams = { name: "AES-GCM", iv: bs(iv) };
  if (aad) params.additionalData = bs(aad);
  // Throws OperationError on auth failure.
  return new Uint8Array(await subtle().decrypt(params, key, bs(data.subarray(4 + IV_LEN))));
}

export async function sealJson(key: CryptoKey, value: unknown, aad?: Uint8Array): Promise<Uint8Array> {
  return sealBlob(key, utf8Encode(JSON.stringify(value)), aad);
}
export async function openJson<T = unknown>(key: CryptoKey, data: Uint8Array, aad?: Uint8Array): Promise<T> {
  return JSON.parse(utf8Decode(await openBlob(key, data, aad))) as T;
}

/** Fresh random raw 256-bit content key. */
export function generateContentKey(): Uint8Array {
  return randomBytes(32);
}
/** Import raw 32-byte key as non-extractable AES-GCM key. */
export function importContentKey(raw: Uint8Array): Promise<CryptoKey> {
  return subtle().importKey("raw", bs(raw), { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}
export function importContentKeyB64(b64: string): Promise<CryptoKey> {
  return importContentKey(fromBase64(b64));
}
