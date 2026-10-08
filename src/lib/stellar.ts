import { Asset, Horizon, NotFoundError, StrKey } from "@stellar/stellar-sdk";
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
