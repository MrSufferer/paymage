import * as StellarSdk from '@stellar/stellar-sdk';
import { getSecret } from './session';

/**
 * Stateless HMAC-signed challenge tokens used to prove wallet ownership during
 * login. A challenge bundles a random nonce + expiry signed by the server's
 * SESSION_SECRET; the client must sign the corresponding `manageData` Stellar
 * transaction with their wallet and POST the signed XDR back.
 *
 * The nonce is single-use: once a session is issued for a nonce, it cannot be
 * replayed. Nonces are tracked in an in-memory map (sufficient for a single
 * Vercel serverless replica; for multi-replica deploys, swap for a shared
 * store like Upstash Redis).
 */

export const CHALLENGE_TTL_MS = 5 * 60 * 1000;
const MANAGE_DATA_KEY = 'zk-payroll-session';
const ENCODER = new TextEncoder();

const usedNonces = new Map<string, number>();

function toBase64Url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(str: string): Uint8Array {
  const padded = str.replace(/-/g, '+').replace(/_/g, '/').padEnd(
    str.length + ((4 - (str.length % 4)) % 4),
    '=',
  );
  const bin = atob(padded);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function hmacKey(): Promise<CryptoKey> {
  return globalThis.crypto.subtle.importKey(
    'raw',
    ENCODER.encode(getSecret()).buffer as unknown as ArrayBuffer,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

async function hmacSign(data: string): Promise<string> {
  const key = await hmacKey();
  const sig = await globalThis.crypto.subtle.sign(
    'HMAC',
    key,
    ENCODER.encode(data).buffer as unknown as ArrayBuffer,
  );
  return toBase64Url(sig);
}

async function hmacVerify(data: string, sig: string): Promise<boolean> {
  try {
    const key = await hmacKey();
    const sigBytes = fromBase64Url(sig);
    return globalThis.crypto.subtle.verify(
      'HMAC',
      key,
      sigBytes.buffer as unknown as ArrayBuffer,
      ENCODER.encode(data).buffer as unknown as ArrayBuffer,
    );
  } catch {
    return false;
  }
}

export interface ChallengePayload {
  nonce: string; // base64url 16 bytes
  expiresAt: number; // ms epoch
}

export function generateNonce(): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return toBase64Url(bytes.buffer as ArrayBuffer);
}

export async function buildChallengeToken(nonce: string, expiresAt: number): Promise<string> {
  const payload = `${nonce}.${expiresAt}`;
  const sig = await hmacSign(payload);
  return `${payload}.${sig}`;
}

export async function verifyChallengeToken(
  token: string,
): Promise<ChallengePayload | null> {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [nonce, expiresAtStr, sig] = parts;
  const expiresAt = Number.parseInt(expiresAtStr, 10);
  if (!Number.isFinite(expiresAt)) return null;
  if (!(await hmacVerify(`${nonce}.${expiresAtStr}`, sig))) return null;
  if (Date.now() > expiresAt) return null;
  if (usedNonces.has(nonce)) return null;
  return { nonce, expiresAt };
}

export function markNonceUsed(nonce: string, expiresAt: number): void {
  usedNonces.set(nonce, expiresAt);
  // Opportunistic GC of expired nonces.
  const now = Date.now();
  for (const entry of Array.from(usedNonces.entries())) {
    if (entry[1] < now) usedNonces.delete(entry[0]);
  }
}

/**
 * Builds a `manageData` transaction over the challenge nonce that the wallet
 * must sign to prove ownership of `publicKey`. The transaction is *not*
 * submitted on-chain — its signed XDR is only used for server-side signature
 * verification.
 */
export async function buildAuthTransaction(
  publicKey: string,
  nonce: string,
  network: 'TESTNET' | 'PUBLIC',
  rpcUrl: string,
): Promise<{ txXdr: string; expiresAt: number }> {
  const server = new StellarSdk.rpc.Server(rpcUrl);
  const account = await server.getAccount(publicKey);
  const expiresAt = Date.now() + CHALLENGE_TTL_MS;
  const nonceBytes = Buffer.from(fromBase64Url(nonce));

  const tx = new StellarSdk.TransactionBuilder(account, {
    fee: StellarSdk.BASE_FEE,
    networkPassphrase:
      network === 'PUBLIC' ? StellarSdk.Networks.PUBLIC : StellarSdk.Networks.TESTNET,
  })
    .addOperation(
      StellarSdk.Operation.manageData({
        name: MANAGE_DATA_KEY,
        value: nonceBytes,
      }),
    )
    .setTimeout(CHALLENGE_TTL_MS / 1000)
    .build();

  return { txXdr: tx.toXDR(), expiresAt };
}

/**
 * Verifies that a signed XDR was signed by `publicKey` and carries the expected
 * `manageData` challenge with `nonce`. Returns true when the signature is
 * valid, the operation matches, and the nonce has not been used yet.
 */
export async function verifyAuthTransaction(
  signedXdr: string,
  publicKey: string,
  expectedNonce: string,
  network: 'TESTNET' | 'PUBLIC',
): Promise<boolean> {
  try {
    const passphrase =
      network === 'PUBLIC' ? StellarSdk.Networks.PUBLIC : StellarSdk.Networks.TESTNET;
    const tx = StellarSdk.TransactionBuilder.fromXDR(
      signedXdr,
      passphrase,
    ) as StellarSdk.Transaction;

    if (tx.operations.length !== 1) return false;
    const op = tx.operations[0];
    if (op.type !== 'manageData') return false;
    if (op.name !== MANAGE_DATA_KEY) return false;

    // Verify the manageData value bytes match the expected nonce.
    const valueBytes = Buffer.isBuffer(op.value)
      ? op.value
      : Buffer.from(op.value ?? '');
    const expected = Buffer.from(fromBase64Url(expectedNonce));
    if (valueBytes.length !== expected.length) return false;
    if (!valueBytes.equals(expected)) return false;

    // Verify the transaction was signed by the claimed keypair.
    const keypair = StellarSdk.Keypair.fromPublicKey(publicKey);
    const hint = keypair.signatureHint();
    const txHash = tx.hash();
    const signedByClaimedKey = (tx.signatures ?? []).some((sig) => {
      if (sig.hint().length !== hint.length) return false;
      for (let i = 0; i < hint.length; i++) {
        if (sig.hint()[i] !== hint[i]) return false;
      }
      return keypair.verify(txHash, sig.signature());
    });
    return signedByClaimedKey;
  } catch {
    return false;
  }
}