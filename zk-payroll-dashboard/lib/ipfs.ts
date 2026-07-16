import { createLogger } from "./logger";

const log = createLogger("ipfs");

const PINATA_API_KEY = process.env.NEXT_PUBLIC_PINATA_API_KEY ?? "";
const IPFS_GATEWAY =
  process.env.NEXT_PUBLIC_IPFS_GATEWAY ?? "https://gateway.pinata.cloud";

export interface IpfsUploadResult {
  cid: string;
  size: number;
  /** True when the CID was produced by the mock fallback (no Pinata key configured). */
  mock: boolean;
}

function pinataHeaders(): Record<string, string> {
  if (PINATA_API_KEY.startsWith("eyJ")) {
    return { Authorization: `Bearer ${PINATA_API_KEY}` };
  }
  return { pinata_api_key: PINATA_API_KEY };
}

/**
 * Deterministic "demo" CID used when no Pinata API key is configured. The CID
 * is a stable base32 SHA-256 of the payload so smoke-test runs are reproducible
 * and the on-chain `run_payroll` call still receives a well-formed string.
 *
 * NOTE: the encrypted blob is NOT retrievable from real IPFS in this mode.
 */
function mockCid(data: Uint8Array): string {
  // Tiny synchronous SHA-256 fallback using a fixed-key mixing function is not
  // cryptographic; we use a simple hash-of-bytes here for reproducibility only.
  // For a true demo, the contents are also written to console in dev.
  let h = 0x811c9dc5;
  for (let i = 0; i < data.length; i++) {
    h ^= data[i];
    // FNV-1a 32-bit multiply
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  const hex = h.toString(16).padStart(8, "0").repeat(8);
  // Base32 of first 32 hex chars → 52 base32 chars, prefixed with "bafy" shape.
  const base32 = "abcdefghijklmnopqrstuvwxyz234567";
  let bits = 0;
  let value = 0;
  let out = "bafy";
  for (let i = 0; i < hex.length; i++) {
    value = (value << 4) | parseInt(hex[i], 16);
    bits += 4;
    if (bits >= 5) {
      out += base32[(value >>> (bits - 5)) & 0x1f];
      bits -= 5;
    }
  }
  if (bits > 0) {
    out += base32[(value << (5 - bits)) & 0x1f];
  }
  return out;
}

export async function uploadToIpfs(data: Uint8Array): Promise<IpfsUploadResult> {
  const internalUpload = await fetch("/api/ipfs/upload", {
    method: "POST",
    headers: { "content-type": "application/octet-stream" },
    body: new Blob([data as unknown as BlobPart]),
  }).catch(() => null);

  if (internalUpload?.ok) {
    return (await internalUpload.json()) as IpfsUploadResult;
  }

  if (!PINATA_API_KEY) {
    log.warn(
      "PINATA_JWT not configured on the upload API — using mock demo CID. Encrypted blob is NOT on real IPFS.",
    );
    const cid = mockCid(data);
    return { cid, size: data.length, mock: true };
  }

  const form = new FormData();
  form.append(
    "file",
    data instanceof Blob ? data : new Blob([data as unknown as BlobPart]),
  );

  const res = await fetch("https://api.pinata.cloud/pinning/pinFileToIPFS", {
    method: "POST",
    headers: pinataHeaders(),
    body: form,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Pinata upload failed (${res.status}): ${text}`);
  }

  const json = await res.json();
  return {
    cid: json.IpfsHash as string,
    size: json.PinSize ?? data.length,
    mock: false,
  };
}

export async function fetchFromIpfs(cid: string): Promise<Uint8Array> {
  const url = cid.startsWith("http")
    ? cid
    : `${IPFS_GATEWAY}/ipfs/${cid}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`IPFS fetch failed (${res.status}) for ${cid}`);
  }
  return new Uint8Array(await res.arrayBuffer());
}
