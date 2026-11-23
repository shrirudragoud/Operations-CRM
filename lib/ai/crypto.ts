import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

// A person's Gemini key is encrypted here, in the app, before it reaches the database (ops.ai_key.cipher).
// AES-256-GCM with a random nonce. The person's id is bound in as associated data, so a ciphertext copied
// into someone else's row will not decrypt. The master key is AI_KEY_SECRET (32 random bytes, base64) and
// lives only in the app's environment.

const VERSION = "v1";
type Env = Record<string, string | undefined>;

export class KeyVaultError extends Error {}

function masterKey(env: Env): Buffer {
  const raw = env.AI_KEY_SECRET;
  if (!raw) throw new KeyVaultError("The assistant is not set up on this server yet (AI_KEY_SECRET is missing). Tell the founder.");
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) throw new KeyVaultError("AI_KEY_SECRET must be 32 random bytes in base64 (openssl rand -base64 32).");
  return key;
}

export function vaultConfigured(env: Env = process.env): boolean {
  try {
    masterKey(env);
    return true;
  } catch {
    return false;
  }
}

export function encryptKey(plain: string, staffId: string, env: Env = process.env): string {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", masterKey(env), nonce);
  cipher.setAAD(Buffer.from(staffId));
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return `${VERSION}.${Buffer.concat([nonce, cipher.getAuthTag(), body]).toString("base64url")}`;
}

export function decryptKey(stored: string, staffId: string, env: Env = process.env): string {
  const [version, packed] = stored.split(".");
  if (version !== VERSION || !packed) throw new KeyVaultError("Your saved Gemini key could not be read. Add it again.");
  const bytes = Buffer.from(packed, "base64url");
  if (bytes.length < 12 + 16 + 1) throw new KeyVaultError("Your saved Gemini key could not be read. Add it again.");
  try {
    const decipher = createDecipheriv("aes-256-gcm", masterKey(env), bytes.subarray(0, 12));
    decipher.setAAD(Buffer.from(staffId));
    decipher.setAuthTag(bytes.subarray(12, 28));
    return Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString("utf8");
  } catch (e) {
    if (e instanceof KeyVaultError) throw e;
    throw new KeyVaultError("Your saved Gemini key could not be read. Add it again.");
  }
}

/** The last four characters, enough to recognise a key without revealing it. */
export function keyHint(key: string): string {
  return key.slice(-4);
}

/** Gemini keys (AIza... or the newer AQ.... form) are one token of letters, digits, dots, dashes and underscores. Rejects pasted text early. */
export function looksLikeGeminiKey(key: string): boolean {
  return /^[A-Za-z0-9._-]{20,200}$/.test(key);
}
