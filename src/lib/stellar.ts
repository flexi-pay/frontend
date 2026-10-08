import {
  Account,
  Asset,
  BASE_FEE,
  Horizon,
  Memo,
  NotFoundError,
  Operation,
  StrKey,
  TransactionBuilder,
  xdr,
} from "@stellar/stellar-sdk";
import { NETWORK } from "./config";

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
