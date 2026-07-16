'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useStellar } from '@/components/providers/StellarProvider';
import { useWalletStore } from '@/stores/walletStore';

interface ChallengeResponse {
  txXdr: string;
  token: string;
  expiresAt: number;
}

export default function LoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { connect, signTx, isFreighterInstalled } = useStellar();
  const { publicKey, isConnected, isLoading } = useWalletStore();
  const [isCreatingSession, setIsCreatingSession] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const redirect = searchParams.get('redirect') || '/dashboard';

  useEffect(() => {
    if (!isConnected || !publicKey) return;
    const publicKeyStr = publicKey;

    async function createSession() {
      setIsCreatingSession(true);
      setError(null);

      try {
        // 1. Fetch a server-issued challenge transaction for this wallet.
        const challengeRes = await fetch(
          `/api/auth/challenge?publicKey=${encodeURIComponent(publicKeyStr)}`,
        );
        if (!challengeRes.ok) {
          const data = await challengeRes.json();
          throw new Error(data.error || 'Failed to issue challenge');
        }
        const challenge = (await challengeRes.json()) as ChallengeResponse;

        // 2. Ask Freighter to sign the challenge transaction. This proves
        //    wallet ownership without exposing admin role spoofing.
        const signedXdr = await signTx(challenge.txXdr);
        if (!signedXdr) {
          throw new Error('User rejected the signing challenge.');
        }

        // 3. Submit the signed challenge + token to the session endpoint.
        const sessionRes = await fetch('/api/auth/session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ publicKey: publicKeyStr, token: challenge.token, signedXdr }),
        });

        if (!sessionRes.ok) {
          const data = await sessionRes.json();
          throw new Error(data.error || 'Failed to create session');
        }

        router.push(redirect);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Session creation failed');
      } finally {
        setIsCreatingSession(false);
      }
    }

    createSession();
  }, [isConnected, publicKey, redirect, router, signTx]);

  const handleConnect = async () => {
    setError(null);
    await connect();
  };

  const loading = isLoading || isCreatingSession;

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
      <div className="w-full max-w-md rounded-md border border-slate-200 bg-white p-8">
        <h1 className="mb-2 text-center text-2xl font-semibold text-slate-950">
          PayMage
        </h1>
        <p className="mb-8 text-center text-sm text-slate-600">
          Connect Freighter to sign PayMage testnet payroll actions.
        </p>

        {error && (
          <div className="mb-4 rounded-md bg-red-50 p-3 text-sm text-red-700">
            {error}
          </div>
        )}

        <button
          onClick={handleConnect}
          disabled={loading}
          className="w-full rounded-md bg-teal-700 px-4 py-3 text-sm font-medium text-white hover:bg-teal-800 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2"
        >
          {loading
            ? 'Connecting...'
            : isConnected
              ? 'Confirming wallet ownership...'
              : 'Connect Wallet'}
        </button>

        {!isFreighterInstalled && (
          <p className="mt-4 text-center text-xs text-gray-400">
            Freighter wallet extension is required.{' '}
            <a
              href="https://www.freighter.app/"
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:text-gray-600"
            >
              Install Freighter
            </a>
          </p>
        )}
      </div>
    </main>
  );
}
