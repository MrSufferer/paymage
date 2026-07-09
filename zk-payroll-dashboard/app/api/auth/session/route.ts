import { NextRequest, NextResponse } from 'next/server';
import { createSessionToken, SESSION_COOKIE_NAME } from '@/lib/auth/session';
import {
  markNonceUsed,
  verifyAuthTransaction,
  verifyChallengeToken,
} from '@/lib/auth/challenge';
import { getServerEnv } from '@/lib/env';
import type { UserRole } from '@/types';

// Fail fast at boot when server-only secrets are misconfigured.
getServerEnv();

/**
 * POST /api/auth/session
 * Body: { publicKey: string, token: string, signedXdr: string }
 *
 * Verifies the wallet signed the challenge transaction with `manageData` and
 * the nonce in the challenge token matches the signed nonce. Issues a 24h
 * HMAC-signed session cookie. Prevents the prior spoofing attack where a
 * caller could mint any role by sending only `publicKey`.
 */
export async function POST(request: NextRequest) {
  try {
    const { publicKey, token, signedXdr } = await request.json();

    if (!publicKey || typeof publicKey !== 'string') {
      return NextResponse.json({ error: 'publicKey is required' }, { status: 400 });
    }
    if (!token || typeof token !== 'string') {
      return NextResponse.json({ error: 'token is required' }, { status: 400 });
    }
    if (!signedXdr || typeof signedXdr !== 'string') {
      return NextResponse.json({ error: 'signedXdr is required' }, { status: 400 });
    }

    const challenge = await verifyChallengeToken(token);
    if (!challenge) {
      return NextResponse.json(
        { error: 'Invalid or expired challenge token.' },
        { status: 401 },
      );
    }

    const env = getServerEnv();
    const network = env.NEXT_PUBLIC_STELLAR_NETWORK;
    const signedOK = await verifyAuthTransaction(
      signedXdr,
      publicKey,
      challenge.nonce,
      network,
    );
    if (!signedOK) {
      return NextResponse.json(
        { error: 'Signature verification failed.' },
        { status: 401 },
      );
    }

    markNonceUsed(challenge.nonce, challenge.expiresAt);

    const role: UserRole =
      publicKey === env.ADMIN_PUBLIC_KEY ? 'admin' : 'employee';

    const sessionToken = await createSessionToken(publicKey, role);
    const response = NextResponse.json({ success: true, role });
    response.cookies.set(SESSION_COOKIE_NAME, sessionToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24,
    });
    return response;
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to create session';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE() {
  const response = NextResponse.json({ success: true });
  response.cookies.set(SESSION_COOKIE_NAME, '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  });
  return response;
}