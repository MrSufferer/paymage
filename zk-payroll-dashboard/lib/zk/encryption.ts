const IV_LENGTH = 12;
const TAG_LENGTH = 16;

export interface EncryptedPayload {
  iv: Uint8Array;
  ciphertext: Uint8Array;
  tag: Uint8Array;
}

export async function deriveViewKey(viewKeyId: string): Promise<CryptoKey> {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(viewKeyId.padEnd(32, "0").slice(0, 32)),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: new TextEncoder().encode("zk-payroll-salt-v1"),
      iterations: 100_000,
      hash: "SHA-256",
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

export async function encryptSalaryBlob(
  employeeId: string,
  salaryAmount: string,
  salt: string,
  viewKey: CryptoKey
): Promise<EncryptedPayload> {
  const iv = new Uint8Array(IV_LENGTH);
  crypto.getRandomValues(iv);
  const plaintext = JSON.stringify({ employeeId, salaryAmount, salt });

  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv.buffer as ArrayBuffer, tagLength: 128 },
    viewKey,
    new TextEncoder().encode(plaintext).buffer as ArrayBuffer
  );

  const raw = new Uint8Array(encrypted);
  return {
    iv,
    ciphertext: raw.slice(0, raw.length - TAG_LENGTH),
    tag: raw.slice(raw.length - TAG_LENGTH),
  };
}

export async function decryptSalaryBlob(
  payload: EncryptedPayload,
  viewKey: CryptoKey
): Promise<{ employeeId: string; salaryAmount: string; salt: string }> {
  const combined = new Uint8Array(payload.ciphertext.length + payload.tag.length);
  combined.set(payload.ciphertext);
  combined.set(payload.tag, payload.ciphertext.length);

  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: payload.iv.buffer as ArrayBuffer, tagLength: 128 },
    viewKey,
    combined.buffer as ArrayBuffer
  );

  return JSON.parse(new TextDecoder().decode(decrypted));
}

export function serializeEncryptedPayload(payload: EncryptedPayload): Uint8Array {
  const buf = new Uint8Array(IV_LENGTH + payload.ciphertext.length + TAG_LENGTH);
  buf.set(payload.iv);
  buf.set(payload.ciphertext, IV_LENGTH);
  buf.set(payload.tag, IV_LENGTH + payload.ciphertext.length);
  return buf;
}

export function deserializeEncryptedPayload(data: Uint8Array): EncryptedPayload {
  const iv = data.slice(0, IV_LENGTH);
  const tag = data.slice(data.length - TAG_LENGTH);
  const ciphertext = data.slice(IV_LENGTH, data.length - TAG_LENGTH);
  return { iv, ciphertext, tag };
}
