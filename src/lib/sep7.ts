// SEP-7 payment request URIs (web+stellar:pay?...) — readable by LOBSTR, xBull, Freighter mobile and other Stellar wallets.
import { StrKey } from "@stellar/stellar-sdk";

export interface PayRequest {
  destination: string;
  amount?: string;
  assetCode?: string;
  assetIssuer?: string;
  memo?: string;
  memoType?: "text" | "id" | "hash";
  msg?: string;
}

export function buildPayUri(r: PayRequest): string {
  const p = new URLSearchParams({ destination: r.destination });
  if (r.amount) p.set("amount", r.amount);
  if (r.assetCode && r.assetCode !== "XLM") {
    p.set("asset_code", r.assetCode);
    if (r.assetIssuer) p.set("asset_issuer", r.assetIssuer);
  }
  if (r.memo) {
    p.set("memo", r.memo);
    p.set("memo_type", `MEMO_${(r.memoType ?? "text").toUpperCase()}`);
  }
  if (r.msg) p.set("msg", r.msg);
  return `web+stellar:pay?${p.toString()}`;
}

/** Accepts a SEP-7 pay URI or a bare G… address. */
export function parsePayUri(text: string): PayRequest {
  const t = text.trim();
  if (StrKey.isValidEd25519PublicKey(t)) return { destination: t };
  if (!t.startsWith("web+stellar:pay?")) throw new Error("This code isn't a Stellar payment request or address");
  const p = new URLSearchParams(t.slice("web+stellar:pay?".length));
  const destination = p.get("destination") ?? "";
  if (!StrKey.isValidEd25519PublicKey(destination)) throw new Error("Payment request has an invalid destination");
  const mt = (p.get("memo_type") ?? "MEMO_TEXT").replace("MEMO_", "").toLowerCase();
  return {
    destination,
    amount: p.get("amount") ?? undefined,
    assetCode: p.get("asset_code") ?? undefined,
    assetIssuer: p.get("asset_issuer") ?? undefined,
    memo: p.get("memo") ?? undefined,
    memoType: (["text", "id", "hash"].includes(mt) ? mt : "text") as PayRequest["memoType"],
    msg: p.get("msg") ?? undefined,
  };
}
