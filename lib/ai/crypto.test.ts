import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decryptKey, encryptKey, keyHint, KeyVaultError, looksLikeGeminiKey, vaultConfigured } from "./crypto";

const env = { AI_KEY_SECRET: randomBytes(32).toString("base64") };
const ME = "11111111-1111-4111-8111-111111111111";
const YOU = "22222222-2222-4222-8222-222222222222";
const KEY = "AIzaSyD-example_key_0123456789abcdefghi";

describe("key vault", () => {
  it("round-trips a key", () => {
    expect(decryptKey(encryptKey(KEY, ME, env), ME, env)).toBe(KEY);
  });
  it("never contains the plain key and differs every time", () => {
    const a = encryptKey(KEY, ME, env);
    const b = encryptKey(KEY, ME, env);
    expect(a).not.toContain(KEY);
    expect(a).not.toBe(b);
    expect(a.startsWith("v1.")).toBe(true);
    expect(a.length).toBeLessThan(2000);
  });
  it("will not decrypt for another person", () => {
    expect(() => decryptKey(encryptKey(KEY, ME, env), YOU, env)).toThrow(KeyVaultError);
  });
  it("will not decrypt with another master key", () => {
    const other = { AI_KEY_SECRET: randomBytes(32).toString("base64") };
    expect(() => decryptKey(encryptKey(KEY, ME, env), ME, other)).toThrow(KeyVaultError);
  });
  it("detects tampering", () => {
    const c = encryptKey(KEY, ME, env);
    const flipped = c.slice(0, -2) + (c.endsWith("AA") ? "BB" : "AA");
    expect(() => decryptKey(flipped, ME, env)).toThrow(KeyVaultError);
  });
  it("rejects junk and unknown versions", () => {
    expect(() => decryptKey("nonsense", ME, env)).toThrow(KeyVaultError);
    expect(() => decryptKey("v9.AAAA", ME, env)).toThrow(KeyVaultError);
    expect(() => decryptKey("v1.AAAA", ME, env)).toThrow(KeyVaultError);
  });
  it("says what is wrong when the server secret is missing or short", () => {
    expect(() => encryptKey(KEY, ME, {})).toThrow(/AI_KEY_SECRET is missing/);
    expect(() => encryptKey(KEY, ME, { AI_KEY_SECRET: Buffer.from("short").toString("base64") })).toThrow(/32 random bytes/);
    expect(vaultConfigured({})).toBe(false);
    expect(vaultConfigured(env)).toBe(true);
  });
  it("hints with the last four characters", () => {
    expect(keyHint(KEY)).toBe("ghi".padStart(4, KEY.at(-4)));
    expect(keyHint(KEY)).toHaveLength(4);
  });
  it("accepts a key-shaped token and refuses pasted text", () => {
    expect(looksLikeGeminiKey(KEY)).toBe(true);
    expect(looksLikeGeminiKey("AQ.FAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKE0000")).toBe(true);
    expect(looksLikeGeminiKey("short")).toBe(false);
    expect(looksLikeGeminiKey(`${KEY} and more`)).toBe(false);
    expect(looksLikeGeminiKey(`${KEY}\n`)).toBe(false);
  });
});
