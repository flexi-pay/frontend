// FlexiPay names: pay "nuel*flexipay.app" instead of a G… address (SEP-2 federation),
// and claim your own name with a SEP-53 signed message (flexi-pay/backend).
import { Federation, StrKey } from "@stellar/stellar-sdk";
import { NAMES_API, NAMES_DOMAIN } from "./config";
import type { Signer } from "./signer";

export const namesEnabled = () => !!NAMES_API && !!NAMES_DOMAIN;

export interface Resolved {
  accountId: string;
  stellarAddress?: string;
  memo?: string;
  memoType?: "text" | "id" | "hash";
}

export const isFederationAddress = (s: string) => /^[^*\s]+\*[a-z0-9.-]+\.[a-z]{2,}$/i.test(s.trim());

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`${NAMES_API}${path}`, { ...init, headers: { "content-type": "application/json", ...init?.headers } });
  if (r.status === 204) return undefined as T;
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body?.error || `Names service error (${r.status})`);
  return body as T;
}

/** Resolves a G… address or a name*domain federation address to an account (and memo, if any). */
export async function resolveRecipient(input: string): Promise<Resolved> {
  const q = input.trim();
  if (StrKey.isValidEd25519PublicKey(q)) return { accountId: q };
  if (!isFederationAddress(q)) throw new Error("Enter a G… address or a name like nuel*flexipay.app");
  const domain = q.slice(q.lastIndexOf("*") + 1).toLowerCase();
  let rec: { account_id: string; stellar_address?: string; memo?: string; memo_type?: string };
  try {
    rec = domain === NAMES_DOMAIN && NAMES_API
      ? await api(`/federation?type=name&q=${encodeURIComponent(q)}`)
      : ((await Federation.Server.resolve(q)) as typeof rec);
  } catch (e) {
    throw new Error(`Couldn't find ${q}: ${e instanceof Error ? e.message : e}`);
  }
  if (!StrKey.isValidEd25519PublicKey(rec.account_id)) throw new Error(`${q} doesn't point to a valid account`);
  return {
    accountId: rec.account_id,
    stellarAddress: rec.stellar_address ?? q,
    memo: rec.memo ? String(rec.memo) : undefined,
    memoType: (rec.memo_type as Resolved["memoType"]) ?? (rec.memo ? "text" : undefined),
  };
}

export interface NameInfo { name: string; stellarAddress: string; available: boolean; reason?: string; address?: string }

export const checkName = (name: string) => api<NameInfo>(`/api/names/${encodeURIComponent(name.trim().toLowerCase())}`);

export async function myName(address: string): Promise<string | null> {
  try {
    return (await api<{ stellarAddress: string }>(`/api/accounts/${address}`)).stellarAddress;
  } catch {
    return null;
  }
}

/** The exact text the backend expects to be signed (must match flexi-pay/backend). */
export const nameMessage = (intent: "register" | "delete", name: string, address: string, timestamp: number) =>
  `flexipay:${intent}:${name}:${address}:${timestamp}`;

export async function claimName(signer: Signer, rawName: string): Promise<string> {
  const name = rawName.trim().toLowerCase();
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = await signer.signMessage(nameMessage("register", name, signer.publicKey, timestamp));
  const r = await api<{ stellarAddress: string }>("/api/names", {
    method: "POST",
    body: JSON.stringify({ name, address: signer.publicKey, timestamp, signature }),
  });
  return r.stellarAddress;
}

export async function releaseName(signer: Signer, name: string): Promise<void> {
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = await signer.signMessage(nameMessage("delete", name, signer.publicKey, timestamp));
  await api(`/api/names/${encodeURIComponent(name)}`, { method: "DELETE", body: JSON.stringify({ timestamp, signature }) });
}
