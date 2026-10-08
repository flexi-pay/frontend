import {
  Account,
  Asset,
  BASE_FEE,
  Horizon,
  Keypair,
  Memo,
  NotFoundError,
  Operation,
  StrKey,
  TransactionBuilder,
  xdr,
} from "@stellar/stellar-sdk";
import { NETWORK } from "./config";
import type { Signer } from "./signer";

export const server = new Horizon.Server(NETWORK.horizonUrl);

// ---------- Assets ----------

/** "XLM" / "native" → native; "CODE:ISSUER" → credit asset. */
export function parseAsset(id: string): Asset {
  const t = id.trim();
  if (!t || t.toUpperCase() === "XLM" || t === "native") return Asset.native();
  const [code, issuer] = t.split(":");
  if (!code || !issuer || !StrKey.isValidEd25519PublicKey(issuer)) {
    throw new Error(`Invalid asset "${id}". Use XLM or CODE:ISSUER`);
  }
  return new Asset(code, issuer);
}

export function assetId(a: Asset): string {
  return a.isNative() ? "XLM" : `${a.getCode()}:${a.getIssuer()}`;
}

export interface Balance {
  id: string; // XLM or CODE:ISSUER
  code: string;
  issuer?: string;
  balance: string;
  limit?: string;
  isNative: boolean;
}

export interface AccountState {
  exists: boolean;
  balances: Balance[];
  subentryCount: number;
  sequence?: string;
}

export async function loadAccountState(publicKey: string): Promise<AccountState> {
  try {
    const acc = await server.loadAccount(publicKey);
    const balances: Balance[] = acc.balances
      .filter((b) => b.asset_type !== "liquidity_pool_shares")
      .map((b) => {
        if (b.asset_type === "native") {
          return { id: "XLM", code: "XLM", balance: b.balance, isNative: true };
        }
        const cb = b as Horizon.HorizonApi.BalanceLineAsset;
        return {
          id: `${cb.asset_code}:${cb.asset_issuer}`,
          code: cb.asset_code,
          issuer: cb.asset_issuer,
          balance: cb.balance,
          limit: cb.limit,
          isNative: false,
        };
      });
    return {
      exists: true,
      balances,
      subentryCount: acc.subentry_count,
      sequence: acc.sequence,
    };
  } catch (e) {
    if (e instanceof NotFoundError) return { exists: false, balances: [], subentryCount: 0 };
    throw e;
  }
}

/** XLM that can actually be spent: balance − (2 + subentries) × 0.5 reserve − fee buffer. */
export function spendableXlm(state: AccountState): number {
  const xlm = state.balances.find((b) => b.isNative);
  if (!xlm) return 0;
  const reserve = (2 + state.subentryCount) * 0.5;
  return Math.max(0, parseFloat(xlm.balance) - reserve - 0.01);
}

export async function accountExists(publicKey: string) {
  try {
    await server.loadAccount(publicKey);
    return true;
  } catch (e) {
    if (e instanceof NotFoundError) return false;
    throw e;
  }
}

export async function fundWithFriendbot(publicKey: string) {
  if (!NETWORK.friendbotUrl) throw new Error("Friendbot is only available on testnet");
  const r = await fetch(`${NETWORK.friendbotUrl}?addr=${encodeURIComponent(publicKey)}`);
  if (!r.ok) {
    const body = await r.json().catch(() => ({}));
    throw new Error(body?.detail || `Friendbot failed (${r.status})`);
  }
}

// ---------- Transaction building (pure, testable) ----------

export type MemoInput = { type: "none" | "text" | "id" | "hash"; value?: string };

export function buildMemo(m?: MemoInput): Memo {
  if (!m || m.type === "none" || !m.value) return Memo.none();
  if (m.type === "text") {
    if (new TextEncoder().encode(m.value).length > 28) throw new Error("Text memo max 28 bytes");
    return Memo.text(m.value);
  }
  if (m.type === "id") return Memo.id(m.value);
  // hash memos from anchors are usually base64; accept hex too
  const isHex = /^[0-9a-fA-F]{64}$/.test(m.value);
  return Memo.hash(isHex ? m.value : Buffer.from(m.value, "base64").toString("hex"));
}

export function buildTx(
  source: Account | Horizon.AccountResponse,
  ops: xdr.Operation[],
  memo?: MemoInput,
  fee: string = BASE_FEE,
) {
  const b = new TransactionBuilder(source, {
    fee,
    networkPassphrase: NETWORK.passphrase,
  });
  ops.forEach((op) => b.addOperation(op));
  return b.addMemo(buildMemo(memo)).setTimeout(180).build();
}

export function paymentOps(
  destination: string,
  asset: Asset,
  amount: string,
  destinationExists: boolean,
): xdr.Operation[] {
  if (!StrKey.isValidEd25519PublicKey(destination)) throw new Error("Invalid destination address");
  validateAmount(amount);
  if (!destinationExists) {
    if (!asset.isNative()) {
      throw new Error("Destination account does not exist. Send at least 1 XLM first to create it.");
    }
    if (parseFloat(amount) < 1) throw new Error("Creating a new account needs at least 1 XLM");
    return [Operation.createAccount({ destination, startingBalance: amount })];
  }
  return [Operation.payment({ destination, asset, amount })];
}

export function validateAmount(amount: string) {
  if (!/^\d+(\.\d{1,7})?$/.test(amount) || parseFloat(amount) <= 0) {
    throw new Error("Amount must be a positive number with up to 7 decimals");
  }
}

/** Round down to 7 decimals (Stellar precision). */
export function toStellarAmount(n: number): string {
  return (Math.floor(n * 1e7) / 1e7).toFixed(7);
}

// ---------- Submission ----------

async function currentFee(): Promise<string> {
  try {
    const stats = await server.feeStats();
    // p70 of recent fees, at least base fee, capped to avoid surprises
    return String(Math.min(Math.max(parseInt(stats.fee_charged.p70), 100), 10_000));
  } catch {
    return BASE_FEE;
  }
}

export async function submit(signer: Signer, ops: xdr.Operation[], memo?: MemoInput) {
  const source = await server.loadAccount(signer.publicKey);
  const tx = buildTx(source, ops, memo, await currentFee());
  let signedXdr: string;
  try {
    signedXdr = await signer.sign(tx.toXDR());
  } catch (e) {
    throw new Error(`Signing was cancelled or failed: ${e instanceof Error ? e.message : (e as { message?: string })?.message ?? e}`);
  }
  try {
    return await server.submitTransaction(TransactionBuilder.fromXDR(signedXdr, NETWORK.passphrase));
  } catch (e) {
    throw new Error(horizonError(e));
  }
}

export function horizonError(e: unknown): string {
  const anyE = e as {
    response?: { data?: { extras?: { result_codes?: unknown }; title?: string } };
    message?: string;
  };
  const codes = anyE?.response?.data?.extras?.result_codes as
    | { transaction?: string; operations?: string[] }
    | undefined;
  if (codes) {
    const friendly: Record<string, string> = {
      op_underfunded: "Insufficient balance",
      op_no_trust: "Destination has no trustline for this asset",
      op_no_destination: "Destination account does not exist",
      op_low_reserve: "Not enough XLM to cover the minimum reserve",
      op_line_full: "Destination trustline limit reached",
      op_too_few_offers: "No path / not enough liquidity for this swap",
      op_under_dest_min: "Price moved beyond slippage — try again",
      op_invalid_limit: "Cannot remove a trustline that still has a balance",
      op_src_no_trust: "You have no trustline for this asset",
      tx_insufficient_fee: "Network fee too low — try again",
      tx_bad_seq: "Sequence mismatch — try again",
    };
    const parts = [...(codes.operations ?? []), codes.transaction ?? ""].filter(
      (c) => c && c !== "op_success" && c !== "tx_failed",
    );
    return parts.map((c) => friendly[c] ?? c).join(", ") || "Transaction failed";
  }
  return anyE?.response?.data?.title || anyE?.message || String(e);
}

// ---------- High-level actions ----------

export async function sendPayment(
  signer: Signer,
  destination: string,
  assetIdStr: string,
  amount: string,
  memo?: MemoInput,
) {
  const exists = await accountExists(destination);
  const ops = paymentOps(destination, parseAsset(assetIdStr), amount, exists);
  return submit(signer, ops, memo);
}

export async function changeTrust(signer: Signer, assetIdStr: string, remove = false) {
  const asset = parseAsset(assetIdStr);
  if (asset.isNative()) throw new Error("XLM does not need a trustline");
  return submit(signer, [Operation.changeTrust({ asset, ...(remove ? { limit: "0" } : {}) })]);
}

export interface SwapQuote {
  destAmount: string;
  path: Asset[];
}

export async function quoteSwap(
  fromId: string,
  toId: string,
  amount: string,
): Promise<SwapQuote | null> {
  validateAmount(amount);
  const res = await server.strictSendPaths(parseAsset(fromId), amount, [parseAsset(toId)]).call();
  if (!res.records.length) return null;
  const best = res.records.reduce((a, b) =>
    parseFloat(b.destination_amount) > parseFloat(a.destination_amount) ? b : a,
  );
  const path = best.path.map((p) =>
    p.asset_type === "native" ? Asset.native() : new Asset(p.asset_code, p.asset_issuer),
  );
  return { destAmount: best.destination_amount, path };
}

export function swapOp(
  self: string,
  fromId: string,
  toId: string,
  amount: string,
  quote: SwapQuote,
  slippagePct: number,
) {
  const destMin = toStellarAmount(parseFloat(quote.destAmount) * (1 - slippagePct / 100));
  return Operation.pathPaymentStrictSend({
    sendAsset: parseAsset(fromId),
    sendAmount: amount,
    destination: self,
    destAsset: parseAsset(toId),
    destMin,
    path: quote.path,
  });
}

export async function swap(
  signer: Signer,
  fromId: string,
  toId: string,
  amount: string,
  quote: SwapQuote,
  slippagePct = 1,
) {
  return submit(signer, [swapOp(signer.publicKey, fromId, toId, amount, quote, slippagePct)]);
}

// ---------- History ----------

export interface HistoryItem {
  id: string;
  type: string;
  direction: "in" | "out" | "self";
  amount: string;
  asset: string;
  counterparty: string;
  createdAt: string;
  txHash: string;
  detail?: string;
}

export async function loadHistory(publicKey: string, limit = 30): Promise<HistoryItem[]> {
  try {
    const page = await server.payments().forAccount(publicKey).order("desc").limit(limit).call();
    return page.records.map((r) => normalizeHistory(r as unknown as Record<string, string>, publicKey));
  } catch (e) {
    if (e instanceof NotFoundError) return [];
    throw e;
  }
}

const code = (r: Record<string, string>, prefix = "") =>
  r[`${prefix}asset_type`] === "native" ? "XLM" : r[`${prefix}asset_code`];

export function normalizeHistory(r: Record<string, string>, me: string): HistoryItem {
  const base = { id: r.id, type: r.type, createdAt: r.created_at, txHash: r.transaction_hash };
  if (r.type === "create_account") {
    const out = r.funder === me;
    return {
      ...base,
      direction: out ? "out" : "in",
      amount: r.starting_balance,
      asset: "XLM",
      counterparty: out ? r.account : r.funder,
      detail: "Account created",
    };
  }
  if (r.type === "account_merge") {
    return { ...base, direction: r.into === me ? "in" : "out", amount: "", asset: "XLM", counterparty: r.account, detail: "Account merge" };
  }
  if (r.type.startsWith("path_payment")) {
    const self = r.from === me && r.to === me;
    return {
      ...base,
      direction: self ? "self" : r.from === me ? "out" : "in",
      amount: r.from === me && !self ? r.source_amount : r.amount,
      asset: r.from === me && !self ? code(r, "source_") : code(r),
      counterparty: self ? me : r.from === me ? r.to : r.from,
      detail: self ? `Swapped ${r.source_amount} ${code(r, "source_")} → ${r.amount} ${code(r)}` : "Path payment",
    };
  }
  return {
    ...base,
    direction: r.from === me ? (r.to === me ? "self" : "out") : "in",
    amount: r.amount,
    asset: code(r) ?? "",
    counterparty: r.from === me ? r.to : r.from,
  };
}

export { Keypair, StrKey };
