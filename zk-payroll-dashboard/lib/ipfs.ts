const PINATA_API_KEY = process.env.NEXT_PUBLIC_PINATA_API_KEY ?? "";
const IPFS_GATEWAY = process.env.NEXT_PUBLIC_IPFS_GATEWAY ?? "https://gateway.pinata.cloud";

export interface IpfsUploadResult {
  cid: string;
  size: number;
}

function pinataHeaders(): Record<string, string> {
  if (PINATA_API_KEY.startsWith("eyJ")) {
    return { Authorization: `Bearer ${PINATA_API_KEY}` };
  }
  return { pinata_api_key: PINATA_API_KEY };
}

export async function uploadToIpfs(data: Uint8Array): Promise<IpfsUploadResult> {
  const form = new FormData();
  form.append("file", data instanceof Blob ? data : new Blob([data] as BlobPart[]));

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
  return { cid: json.IpfsHash as string, size: json.PinSize ?? data.length };
}

export async function fetchFromIpfs(cid: string): Promise<Uint8Array> {
  const url = cid.startsWith("http") ? cid : `${IPFS_GATEWAY}/ipfs/${cid}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`IPFS fetch failed (${res.status}) for ${cid}`);
  }
  return new Uint8Array(await res.arrayBuffer());
}

