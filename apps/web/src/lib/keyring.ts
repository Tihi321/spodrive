/** In-memory copy of the (non-extractable) KEK, mirrored in IndexedDB so it survives reloads. */
import { KV, kvDel, kvGet, kvSet } from "./db";

let kek: CryptoKey | null = null;

export const getKek = (): CryptoKey | null => kek;

export function requireKek(): CryptoKey {
  if (!kek) throw new Error("Library is locked");
  return kek;
}

export async function loadStoredKek(): Promise<CryptoKey | null> {
  kek = (await kvGet<CryptoKey>(KV.kek)) ?? null;
  return kek;
}

export async function storeKek(key: CryptoKey): Promise<void> {
  kek = key;
  await kvSet(KV.kek, key);
}

export async function wipeKek(): Promise<void> {
  kek = null;
  await kvDel(KV.kek);
}
