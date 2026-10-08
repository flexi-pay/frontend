// Encrypted local keystore: the secret key is encrypted with a key derived from
// the user's password (PBKDF2-SHA256 → AES-256-GCM) and only ever decrypted in memory.

export interface EncryptedKeystore {
  version: 1;
  publicKey: string;
  salt: string; // base64
  iv: string; // base64
  ciphertext: string; // base64
  iterations: number;
}

const STORAGE_KEY = "stellar-wallet:keystore";
const ITERATIONS = 310_000;

const enc = new TextEncoder();
const dec = new TextDecoder();

const toB64 = (buf: ArrayBuffer | Uint8Array) => {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
};
const fromB64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function deriveKey(password: string, salt: Uint8Array, iterations: number) {
  const base = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, [
    "deriveKey",
  ]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: salt as BufferSource, iterations, hash: "SHA-256" },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function encryptSecret(
  publicKey: string,
  secret: string,
  password: string,
  iterations = ITERATIONS,
): Promise<EncryptedKeystore> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt, iterations);
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv as BufferSource, additionalData: enc.encode(publicKey) },
    key,
    enc.encode(secret),
  );
  return {
    version: 1,
    publicKey,
    salt: toB64(salt),
    iv: toB64(iv),
    ciphertext: toB64(ciphertext),
    iterations,
  };
}

export async function decryptSecret(ks: EncryptedKeystore, password: string): Promise<string> {
  const key = await deriveKey(password, fromB64(ks.salt), ks.iterations);
  try {
    const plain = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: fromB64(ks.iv) as BufferSource,
        additionalData: enc.encode(ks.publicKey),
      },
      key,
      fromB64(ks.ciphertext) as BufferSource,
    );
    return dec.decode(plain);
  } catch {
    throw new Error("Wrong password");
  }
}

export function saveKeystore(ks: EncryptedKeystore) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(ks));
}

export function loadKeystore(): EncryptedKeystore | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as EncryptedKeystore) : null;
  } catch {
    return null;
  }
}

export function clearKeystore() {
  localStorage.removeItem(STORAGE_KEY);
}
