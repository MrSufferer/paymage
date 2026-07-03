import { createLogger } from "@/lib/logger";

const log = createLogger("zk-pk-cache");

const DB_NAME = "stellar-zk-payroll";
const DB_VERSION = 1;
const STORE_NAME = "artifacts";

/** A fetch+cache reference for one large ZK artifact (PK / R1CS / circom WASM). */
export interface ArtifactRef {
  /** Stable cache key (e.g. "payroll_20_proving_key"). */
  name: string;
  /** URL to fetch when not cached. */
  url: string;
  /** Optional SHA-256 pin (hex). If set, a cached entry whose hash differs is re-downloaded. */
  expectedSha256?: string;
  /** Optional expected byte length; mismatch triggers re-download. */
  expectedLength?: number;
}

export interface FetchProgress {
  loaded: number;
  total: number | null;
  percent: number | null;
}

interface CachedArtifact {
  name: string;
  sha256: string;
  length: number;
  bytes: ArrayBuffer;
  cachedAt: number;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB unavailable — cannot cache ZK artifacts"));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "name" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB open failed"));
  });
  return dbPromise;
}

async function readCached(db: IDBDatabase, name: string): Promise<CachedArtifact | null> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const req = tx.objectStore(STORE_NAME).get(name);
    req.onsuccess = () => resolve((req.result as CachedArtifact | undefined) ?? null);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB read failed"));
  });
}

async function writeCached(db: IDBDatabase, entry: CachedArtifact): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(entry);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("IndexedDB write failed"));
    tx.onabort = () => reject(tx.error ?? new Error("IndexedDB write aborted"));
  });
}

async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function matchesExpected(entry: CachedArtifact, ref: ArtifactRef): boolean {
  if (ref.expectedLength !== undefined && entry.length !== ref.expectedLength) {
    log.warn("Artifact length mismatch — re-downloading", {
      name: ref.name,
      cached: entry.length,
      expected: ref.expectedLength,
    });
    return false;
  }
  if (ref.expectedSha256 && entry.sha256 !== ref.expectedSha256) {
    log.warn("Artifact SHA-256 mismatch — re-downloading", {
      name: ref.name,
      cached: entry.sha256,
      expected: ref.expectedSha256,
    });
    return false;
  }
  return true;
}

async function fetchWithProgress(
  ref: ArtifactRef,
  onProgress?: (p: FetchProgress) => void
): Promise<ArrayBuffer> {
  const response = await fetch(ref.url, { cache: "force-cache" });
  if (!response.ok) {
    throw new Error(`Fetch ${ref.name} failed: ${response.status} ${response.statusText}`);
  }
  const total = Number(response.headers.get("content-length") ?? 0) || null;

  if (!response.body || !onProgress) {
    const buf = await response.arrayBuffer();
    onProgress?.({ loaded: buf.byteLength, total, percent: total ? (buf.byteLength / total) * 100 : null });
    return buf;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      loaded += value.byteLength;
      onProgress({ loaded, total, percent: total ? (loaded / total) * 100 : null });
    }
  }
  const merged = new Uint8Array(loaded);
  let offset = 0;
  for (const c of chunks) {
    merged.set(c, offset);
    offset += c.byteLength;
  }
  return merged.buffer;
}

/**
 * Get an artifact bytes from cache, fetching + caching on miss.
 * Validates length and (optionally) SHA-256 pin.
 */
export async function getArtifact(
  ref: ArtifactRef,
  onProgress?: (p: FetchProgress) => void
): Promise<ArrayBuffer> {
  const db = await openDb();

  const cached = await readCached(db, ref.name);
  if (cached && matchesExpected(cached, ref)) {
    log.info("Artifact cache hit", { name: ref.name, length: cached.length });
    onProgress?.({ loaded: cached.length, total: cached.length, percent: 100 });
    return cached.bytes;
  }

  log.info("Artifact cache miss — downloading", { name: ref.name, url: ref.url });
  const bytes = await fetchWithProgress(ref, onProgress);
  const sha256 = await sha256Hex(bytes);

  if (ref.expectedSha256 && sha256 !== ref.expectedSha256) {
    throw new Error(
      `Artifact ${ref.name} SHA-256 mismatch after download: got ${sha256}, expected ${ref.expectedSha256}`
    );
  }
  if (ref.expectedLength !== undefined && bytes.byteLength !== ref.expectedLength) {
    throw new Error(
      `Artifact ${ref.name} length mismatch after download: got ${bytes.byteLength}, expected ${ref.expectedLength}`
    );
  }

  const entry: CachedArtifact = {
    name: ref.name,
    sha256,
    length: bytes.byteLength,
    bytes,
    cachedAt: Date.now(),
  };

  try {
    await writeCached(db, entry);
  } catch (err) {
    // A common cause: QuotaExceededError when the 1 GB PK exceeds the origin's
    // storage quota. Surfacing this explicitly so the UI can prompt for
    // persistent storage.
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Failed to cache artifact ${ref.name} (${bytes.byteLength} bytes): ${msg}. ` +
        `Call navigator.storage.persist() to request persistent storage.`,
      { cause: err }
    );
  }

  log.info("Artifact cached", { name: ref.name, length: entry.length, sha256 });
  return bytes;
}

/** Remove a single artifact from the cache. */
export async function evictArtifact(name: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).delete(name);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("IndexedDB delete failed"));
  });
}

/** Total bytes used by the artifact cache (approximate). */
export async function cacheSize(): Promise<number> {
  if (navigator.storage?.estimate) {
    const est = await navigator.storage.estimate();
    return est.usage ?? 0;
  }
  return 0;
}

/** Request persistent storage — recommended before downloading the 1 GB PK. */
export async function requestPersistentStorage(): Promise<boolean> {
  if (navigator.storage?.persist) {
    return navigator.storage.persist();
  }
  return false;
}
