import { NextRequest, NextResponse } from "next/server";
import { badRequestResponse, errorResponse } from "@/lib/api/response";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const CID_PATTERN = /^(bafy[a-z2-7]+|Qm[1-9A-HJ-NP-Za-km-z]{44})$/;

export async function GET(request: NextRequest) {
  const cid = request.nextUrl.searchParams.get("cid");
  if (!cid || !CID_PATTERN.test(cid)) {
    return badRequestResponse("Valid IPFS CID is required");
  }

  const gateway =
    process.env.NEXT_PUBLIC_IPFS_GATEWAY ?? "https://gateway.pinata.cloud";
  const upstream = await fetch(`${gateway.replace(/\/$/, "")}/ipfs/${cid}`, {
    cache: "no-store",
  }).catch((err) => err as Error);

  if (upstream instanceof Error) {
    return errorResponse("IPFS_FETCH_FAILED", upstream.message, 502);
  }
  if (!upstream.ok) {
    return errorResponse(
      "IPFS_FETCH_FAILED",
      `IPFS gateway returned ${upstream.status}`,
      upstream.status,
    );
  }

  return new NextResponse(await upstream.arrayBuffer(), {
    headers: {
      "content-type": "application/octet-stream",
      "cache-control": "no-store",
    },
  });
}
