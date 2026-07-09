import { NextRequest, NextResponse } from 'next/server';
import { publicEnv } from '@/lib/env';
import {
  buildAuthTransaction,
  buildChallengeToken,
  generateNonce,
} from '@/lib/auth/challenge';

/**
 * GET /api/auth/challenge?publicKey=G...
 *
 * Issues an unsigned `manageData` challenge transaction that the caller must
 * sign with their wallet and POST back to /api/auth/session to prove wallet
 * ownership. Returns `{ txXdr, token, expiresAt }`.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const publicKey = searchParams.get('publicKey');
  if (!publicKey || !publicKey.startsWith('G')) {
    return NextResponse.json(
      { error: 'A "publicKey" query parameter (G...) is required.' },
      { status: 400 },
    );
  }

  const network = publicEnv.NEXT_PUBLIC_STELLAR_NETWORK;
  const rpcUrl = publicEnv.NEXT_PUBLIC_SOROBAN_RPC_URL;
  const nonce = generateNonce();
  try {
    const { txXdr, expiresAt } = await buildAuthTransaction(
      publicKey,
      nonce,
      network,
      rpcUrl,
    );
    const token = await buildChallengeToken(nonce, expiresAt);
    return NextResponse.json({ txXdr, token, expiresAt });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'Failed to build challenge.';
    // Account not yet funded on testnet → suggest Friendbot.
    if (network === 'TESTNET' && /404|not found/i.test(message)) {
      return NextResponse.json(
        {
          error:
            'Wallet account not found on testnet. Fund it first at https://friendbot.stellar.org/ then retry.',
        },
        { status: 404 },
      );
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}