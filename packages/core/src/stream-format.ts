/**
 * SPD1 chunked encrypted file format.
 *
 * Header (20 bytes):
 *   0..3   magic "SPD1"
 *   4      version (u8, = 1)
 *   5..7   reserved (zero)
 *   8..11  chunkSize, plaintext bytes per chunk (u32 big-endian, default 65536)
 *   12..19 random nonce prefix (8 bytes)
 * Body: chunks back to back. Chunk i = AES-256-GCM(plaintext chunk) || 16-byte tag.
 *   IV  = noncePrefix(8) || u32BE(i)
 *   AAD = u32BE(i) || u8(isLast)
 * All chunks hold chunkSize plaintext bytes except the last (1..chunkSize bytes,
 * or 0 when the whole file is empty: one empty final chunk).
 */
import { bs, bytesEqual, concat, randomBytes, u32be, utf8Encode } from "./bytes";
import { importContentKey } from "./blob";

export const MAGIC = utf8Encode("SPD1");
export const FORMAT_VERSION = 1;
export const HEADER_SIZE = 20;
export const TAG_SIZE = 16;
export const DEFAULT_CHUNK_SIZE = 65536;

export interface StreamHeader {
  version: number;
  chunkSize: number;
  noncePrefix: Uint8Array;
}

export class StreamFormatError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = "StreamFormatError";
  }
}

export function chunkCount(plainSize: number, chunkSize = DEFAULT_CHUNK_SIZE): number {
  return Math.max(1, Math.ceil(plainSize / chunkSize));
}
export function encryptedSize(plainSize: number, chunkSize = DEFAULT_CHUNK_SIZE): number {
  return HEADER_SIZE + plainSize + TAG_SIZE * chunkCount(plainSize, chunkSize);
}

export function buildHeader(chunkSize: number, noncePrefix: Uint8Array): Uint8Array {
  const h = new Uint8Array(HEADER_SIZE);
  h.set(MAGIC, 0);
  h[4] = FORMAT_VERSION;
  h.set(u32be(chunkSize), 8);
  h.set(noncePrefix, 12);
  return h;
}

export function parseHeader(bytes: Uint8Array): StreamHeader {
  if (bytes.length < HEADER_SIZE) throw new StreamFormatError("Header too short");
  if (!bytesEqual(bytes.subarray(0, 4), MAGIC)) throw new StreamFormatError("Bad magic");
  const version = bytes[4]!;
  if (version !== FORMAT_VERSION) throw new StreamFormatError(`Unsupported version ${version}`);
  const chunkSize = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(8, false);
  if (chunkSize === 0) throw new StreamFormatError("Invalid chunk size");
  return { version, chunkSize, noncePrefix: bytes.slice(12, 20) };
}

function chunkParams(prefix: Uint8Array, index: number, isLast: boolean): AesGcmParams {
  return {
    name: "AES-GCM",
    iv: bs(concat(prefix, u32be(index))),
    additionalData: bs(concat(u32be(index), new Uint8Array([isLast ? 1 : 0]))),
  };
}

type KeyInput = CryptoKey | Uint8Array;
const asKey = (k: KeyInput) => (k instanceof Uint8Array ? importContentKey(k) : Promise.resolve(k));

async function sealChunk(key: CryptoKey, prefix: Uint8Array, index: number, isLast: boolean, pt: Uint8Array) {
  return new Uint8Array(await globalThis.crypto.subtle.encrypt(chunkParams(prefix, index, isLast), key, bs(pt)));
}

export async function encryptFile(
  rawKey: KeyInput,
  plaintext: Uint8Array,
  chunkSize = DEFAULT_CHUNK_SIZE,
): Promise<Uint8Array> {
  const key = await asKey(rawKey);
  const prefix = randomBytes(8);
  const n = chunkCount(plaintext.length, chunkSize);
  const out = new Uint8Array(encryptedSize(plaintext.length, chunkSize));
  out.set(buildHeader(chunkSize, prefix), 0);
  let o = HEADER_SIZE;
  for (let i = 0; i < n; i++) {
    const ct = await sealChunk(key, prefix, i, i === n - 1, plaintext.subarray(i * chunkSize, (i + 1) * chunkSize));
    out.set(ct, o);
    o += ct.length;
  }
  return out;
}

/** Streaming encrypt: yields the header, then each encrypted chunk. */
export async function* encryptStream(
  rawKey: KeyInput,
  source: AsyncIterable<Uint8Array> | Iterable<Uint8Array>,
  chunkSize = DEFAULT_CHUNK_SIZE,
): AsyncGenerator<Uint8Array> {
  const key = await asKey(rawKey);
  const prefix = randomBytes(8);
  yield buildHeader(chunkSize, prefix);
  let buf: Uint8Array = new Uint8Array(0);
  let index = 0;
  let pending: Uint8Array | null = null; // a full chunk held back until we know whether it is last
  for await (const part of source) {
    buf = buf.length ? concat(buf, part) : part;
    while (buf.length >= chunkSize) {
      if (pending) yield await sealChunk(key, prefix, index++, false, pending);
      pending = buf.slice(0, chunkSize);
      buf = buf.subarray(chunkSize);
    }
  }
  if (buf.length > 0 || !pending) {
    if (pending) yield await sealChunk(key, prefix, index++, false, pending);
    yield await sealChunk(key, prefix, index, true, buf);
  } else {
    yield await sealChunk(key, prefix, index, true, pending);
  }
}

export interface RangePlan {
  firstChunk: number;
  lastChunk: number;
  /** Encrypted byte range to fetch (inclusive, includes header offset). */
  encStart: number;
  encEndInclusive: number;
  /** Slice of the decrypted concatenation: [sliceStart, sliceEnd) (end exclusive). */
  sliceStart: number;
  sliceEnd: number;
}

export function planRange(plainSize: number, start: number, endInclusive: number, chunkSize = DEFAULT_CHUNK_SIZE): RangePlan {
  if (!(start >= 0 && endInclusive >= start && endInclusive < plainSize)) {
    throw new RangeError(`Invalid range ${start}-${endInclusive} for size ${plainSize}`);
  }
  const stride = chunkSize + TAG_SIZE;
  const firstChunk = Math.floor(start / chunkSize);
  const lastChunk = Math.floor(endInclusive / chunkSize);
  const encStart = HEADER_SIZE + firstChunk * stride;
  const encEnd = Math.min(HEADER_SIZE + (lastChunk + 1) * stride, encryptedSize(plainSize, chunkSize));
  const base = firstChunk * chunkSize;
  return {
    firstChunk,
    lastChunk,
    encStart,
    encEndInclusive: encEnd - 1,
    sliceStart: start - base,
    sliceEnd: endInclusive - base + 1,
  };
}

/**
 * Decrypt consecutive chunks. `encBytes` starts at the beginning of chunk `firstChunk`
 * (as returned by planRange). `totalChunks` is the chunk count of the whole file, used
 * to set the isLast AAD flag for chunk index totalChunks-1.
 */
export async function decryptChunks(
  rawKey: KeyInput,
  header: StreamHeader,
  encBytes: Uint8Array,
  firstChunk: number,
  totalChunks: number,
): Promise<Uint8Array> {
  const key = await asKey(rawKey);
  const stride = header.chunkSize + TAG_SIZE;
  const parts: Uint8Array[] = [];
  let o = 0;
  let i = firstChunk;
  while (o < encBytes.length) {
    if (i >= totalChunks) throw new StreamFormatError("Trailing data after last chunk");
    const piece = encBytes.subarray(o, o + stride);
    if (piece.length < TAG_SIZE) throw new StreamFormatError("Truncated chunk");
    const pt = await globalThis.crypto.subtle.decrypt(
      chunkParams(header.noncePrefix, i, i === totalChunks - 1),
      key,
      bs(piece),
    );
    parts.push(new Uint8Array(pt));
    o += piece.length;
    i++;
  }
  if (parts.length === 0) throw new StreamFormatError("No chunk data");
  return concat(...parts);
}

export async function decryptFile(rawKey: KeyInput, data: Uint8Array): Promise<Uint8Array> {
  const header = parseHeader(data);
  const body = data.subarray(HEADER_SIZE);
  if (body.length < TAG_SIZE) throw new StreamFormatError("Missing chunks");
  const total = Math.ceil(body.length / (header.chunkSize + TAG_SIZE));
  return decryptChunks(rawKey, header, body, 0, total);
}

/** Decrypt plaintext bytes [start, end] inclusive, fetching only needed encrypted bytes. */
export async function decryptRange(
  rawKey: KeyInput,
  header: StreamHeader,
  plainSize: number,
  start: number,
  end: number,
  fetchEnc: (encStart: number, encEndInclusive: number) => Promise<Uint8Array>,
): Promise<Uint8Array> {
  const plan = planRange(plainSize, start, end, header.chunkSize);
  const enc = await fetchEnc(plan.encStart, plan.encEndInclusive);
  const pt = await decryptChunks(rawKey, header, enc, plan.firstChunk, chunkCount(plainSize, header.chunkSize));
  return pt.subarray(plan.sliceStart, plan.sliceEnd);
}
