import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 30;

function pinataJwt(): string | null {
  return process.env.PINATA_JWT ?? process.env.PINATA_API_JWT ?? null;
}

export async function POST(request: Request) {
  const jwt = pinataJwt();
  if (!jwt) {
    return NextResponse.json(
      { error: "PINATA_JWT is not configured" },
      { status: 503 },
    );
  }

  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.length === 0) {
    return NextResponse.json({ error: "Empty IPFS payload" }, { status: 400 });
  }

  const form = new FormData();
  form.append("file", new Blob([bytes]), "paymage-salary.bin");

  const upstream = await fetch("https://api.pinata.cloud/pinning/pinFileToIPFS", {
    method: "POST",
    headers: { authorization: `Bearer ${jwt}` },
    body: form,
  });

  const payload = await upstream.json().catch(async () => ({
    message: await upstream.text().catch(() => "Pinata returned a non-JSON response"),
  }));

  if (!upstream.ok) {
    return NextResponse.json(
      {
        error: "Pinata upload failed",
        status: upstream.status,
        details: payload,
      },
      { status: upstream.status },
    );
  }

  return NextResponse.json({
    cid: payload.IpfsHash,
    size: payload.PinSize ?? bytes.length,
    mock: false,
  });
}
