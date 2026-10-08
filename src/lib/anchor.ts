// Anchor integration: SEP-1 (stellar.toml), SEP-10 (web auth) and SEP-24 (interactive deposit/withdraw).
// Implemented directly over fetch so it works with any signer (built-in or external wallets).
import { StellarToml, TransactionBuilder, WebAuth } from "@stellar/stellar-sdk";
import { NETWORK } from "./config";
import type { Signer } from "./signer";

export interface AnchorAsset {
  code: string;
  issuer: string;
  deposit: boolean;
  withdraw: boolean;
  depositFee?: string;
  withdrawFee?: string;
  minAmount?: number;
  maxAmount?: number;
}

export interface AnchorSession {
  homeDomain: string;
  token: string;
  transferServer: string;
  assets: AnchorAsset[];
}

function feeText(f?: { fee_fixed?: number; fee_percent?: number }) {
  if (!f) return undefined;
  const parts = [];
  if (f.fee_fixed) parts.push(`${f.fee_fixed} fixed`);
  if (f.fee_percent) parts.push(`${f.fee_percent}%`);
  return parts.length ? parts.join(" + ") : "Shown by anchor";
}

async function json<T>(r: Response): Promise<T> {
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body?.error || `Anchor request failed (${r.status})`);
  return body as T;
}

export async function sep10Auth(homeDomain: string, signer: Signer, toml: StellarToml.Api.StellarToml) {
  const endpoint = toml.WEB_AUTH_ENDPOINT;
  const signingKey = toml.SIGNING_KEY;
  if (!endpoint || !signingKey) throw new Error("Anchor does not support SEP-10 authentication");
  const url = new URL(endpoint);
  url.searchParams.set("account", signer.publicKey);
  url.searchParams.set("home_domain", homeDomain);
  const { transaction, network_passphrase } = await json<{ transaction: string; network_passphrase?: string }>(
    await fetch(url),
  );
  if (network_passphrase && network_passphrase !== NETWORK.passphrase) throw new Error("Anchor is on a different network");
  // Validates: server signed it, sequence 0, correct home domain, time bounds, client account
  const { clientAccountID } = WebAuth.readChallengeTx(
    transaction, signingKey, NETWORK.passphrase, homeDomain, new URL(endpoint).hostname,
  );
  if (clientAccountID !== signer.publicKey) throw new Error("Challenge is for a different account");
  const signed = await signer.sign(TransactionBuilder.fromXDR(transaction, NETWORK.passphrase).toXDR());
  const { token } = await json<{ token: string }>(
    await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ transaction: signed }) }),
  );
  return token;
}

export async function connectAnchor(homeDomain: string, signer: Signer): Promise<AnchorSession> {
  const toml = await StellarToml.Resolver.resolve(homeDomain);
  const transferServer = toml.TRANSFER_SERVER_SEP0024;
  if (!transferServer) throw new Error("This anchor does not support SEP-24 deposits/withdrawals");
  type Info = { deposit?: Record<string, { enabled?: boolean; fee_fixed?: number; fee_percent?: number; min_amount?: number; max_amount?: number }>; withdraw?: Record<string, { enabled?: boolean; fee_fixed?: number; fee_percent?: number }> };
  const [info, token] = await Promise.all([
    fetch(`${transferServer}/info`).then((r) => json<Info>(r)),
    sep10Auth(homeDomain, signer, toml),
  ]);
  const currencies = (toml.CURRENCIES ?? []) as Array<{ code?: string; issuer?: string }>;
  const codes = new Set([...Object.keys(info.deposit ?? {}), ...Object.keys(info.withdraw ?? {})]);
  const assets: AnchorAsset[] = [];
  for (const code of codes) {
    const cur = currencies.find((c) => c.code === code);
    if (code === "native" || !cur?.issuer) continue;
    const d = info.deposit?.[code];
    const w = info.withdraw?.[code];
    assets.push({
      code, issuer: cur.issuer,
      deposit: !!d?.enabled, withdraw: !!w?.enabled,
      depositFee: feeText(d), withdrawFee: feeText(w),
      minAmount: d?.min_amount, maxAmount: d?.max_amount,
    });
  }
  return { homeDomain, token, transferServer, assets };
}

export async function startInteractive(
  s: AnchorSession, kind: "deposit" | "withdraw", assetCode: string, account: string, amount?: string,
): Promise<{ id: string; url: string }> {
  const body: Record<string, string> = { asset_code: assetCode, account, lang: "en" };
  if (amount) body.amount = amount;
  const r = await fetch(`${s.transferServer}/transactions/${kind}/interactive`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${s.token}` },
    body: JSON.stringify(body),
  });
  const res = await json<{ id?: string; url?: string; error?: string }>(r);
  if (!res.url || !res.id) throw new Error(res.error || "Anchor did not return an interactive URL");
  return { id: res.id, url: res.url };
}

export interface AnchorTx {
  id: string;
  kind: string;
  status: string;
  amount_in?: string;
  amount_out?: string;
  amount_fee?: string;
  message?: string;
  more_info_url?: string;
  withdraw_anchor_account?: string;
  withdraw_memo?: string;
  withdraw_memo_type?: "text" | "id" | "hash";
  started_at?: string;
}

export async function getAnchorTx(s: AnchorSession, id: string): Promise<AnchorTx> {
  const r = await fetch(`${s.transferServer}/transaction?id=${encodeURIComponent(id)}`, {
    headers: { Authorization: `Bearer ${s.token}` },
  });
  return (await json<{ transaction: AnchorTx }>(r)).transaction;
}
