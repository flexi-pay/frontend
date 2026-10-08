import { describe, expect, it } from "vitest";
import { Account, Asset, Keypair, StrKey, Transaction } from "@stellar/stellar-sdk";
import { decryptSecret, encryptSecret } from "./keystore";
import {
  buildMemo,
  buildTx,
  normalizeHistory,
  parseAsset,
  paymentOps,
  spendableXlm,
  swapOp,
  toStellarAmount,
  horizonError,
} from "./stellar";
import { NETWORK } from "./config";

const kp = Keypair.random();
const dest = Keypair.random().publicKey();
const USDC = "USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
const SRT = "SRT:GCDNJUBQSX7AJWLJACMJ7I4BC3Z47BQUTMHEICZLE6MU4KQBRYG5JY6B";

describe("keystore", () => {
  it("round-trips and rejects wrong password", async () => {
    const ks = await encryptSecret(kp.publicKey(), kp.secret(), "correct horse", 1000);
    expect(ks.ciphertext).not.toContain(kp.secret());
    expect(await decryptSecret(ks, "correct horse")).toBe(kp.secret());
    await expect(decryptSecret(ks, "wrong")).rejects.toThrow("Wrong password");
  });
  it("detects tampering with the public key", async () => {
    const ks = await encryptSecret(kp.publicKey(), kp.secret(), "pw", 1000);
    await expect(decryptSecret({ ...ks, publicKey: dest }, "pw")).rejects.toThrow();
  });
});

describe("assets", () => {
  it("parses native and credit assets", () => {
    expect(parseAsset("XLM").isNative()).toBe(true);
    expect(parseAsset(USDC).getCode()).toBe("USDC");
    expect(() => parseAsset("USDC:bad")).toThrow();
  });
  it("hardcoded testnet issuers are valid", () => {
    for (const id of [USDC, SRT]) expect(StrKey.isValidEd25519PublicKey(id.split(":")[1])).toBe(true);
  });
});

describe("transactions", () => {
  const src = new Account(kp.publicKey(), "100");

  it("uses createAccount for unfunded destinations", () => {
    const tx = buildTx(src, paymentOps(dest, Asset.native(), "5", false));
    expect(tx.operations[0].type).toBe("createAccount");
    expect(tx.networkPassphrase).toBe(NETWORK.passphrase);
  });
  it("uses payment for existing destinations, with memo", () => {
    const tx = buildTx(src, paymentOps(dest, parseAsset(USDC), "1.5", true), { type: "text", value: "hello" });
    expect(tx.operations[0].type).toBe("payment");
    expect(Buffer.from(tx.memo.value as Uint8Array).toString()).toBe("hello");
  });
  it("rejects bad input", () => {
    expect(() => paymentOps("GABC", Asset.native(), "1", true)).toThrow("Invalid destination");
    expect(() => paymentOps(dest, Asset.native(), "-1", true)).toThrow();
    expect(() => paymentOps(dest, Asset.native(), "1.12345678", true)).toThrow();
    expect(() => paymentOps(dest, parseAsset(USDC), "5", false)).toThrow("does not exist");
    expect(() => paymentOps(dest, Asset.native(), "0.5", false)).toThrow("at least 1 XLM");
    expect(() => buildMemo({ type: "text", value: "x".repeat(29) })).toThrow();
  });
  it("accepts base64 and hex hash memos", () => {
    const hex = "ab".repeat(32);
    expect(buildMemo({ type: "hash", value: hex }).type).toBe("hash");
    expect(buildMemo({ type: "hash", value: Buffer.from(hex, "hex").toString("base64") }).type).toBe("hash");
    expect(buildMemo({ type: "id", value: "12345" }).type).toBe("id");
  });
  it("signs and serializes", () => {
    const tx = buildTx(src, paymentOps(dest, Asset.native(), "1", true));
    tx.sign(kp);
    const back = new Transaction(tx.toXDR(), NETWORK.passphrase);
    expect(back.signatures.length).toBe(1);
    expect(back.source).toBe(kp.publicKey());
  });
  it("builds swap with slippage-protected destMin", () => {
    const op = swapOp(kp.publicKey(), "XLM", USDC, "100", { destAmount: "10.0000000", path: [] }, 1);
    const tx = buildTx(src, [op]);
    const o = tx.operations[0];
    expect(o.type).toBe("pathPaymentStrictSend");
    if (o.type === "pathPaymentStrictSend") {
      expect(o.destMin).toBe("9.9000000");
      expect(o.destination).toBe(kp.publicKey());
    }
    expect(toStellarAmount(1.123456789)).toBe("1.1234567");
  });
});

describe("helpers", () => {
  it("computes spendable XLM after reserves", () => {
    const s = { exists: true, subentryCount: 2, balances: [{ id: "XLM", code: "XLM", balance: "10", isNative: true }] };
    expect(spendableXlm(s)).toBeCloseTo(10 - 2 - 0.01);
  });
  it("normalizes history records", () => {
    const me = kp.publicKey();
    expect(normalizeHistory({ id: "1", type: "payment", from: dest, to: me, amount: "3", asset_type: "native", created_at: "", transaction_hash: "h" }, me).direction).toBe("in");
    expect(normalizeHistory({ id: "2", type: "create_account", funder: dest, account: me, starting_balance: "10000", created_at: "", transaction_hash: "h" }, me).amount).toBe("10000");
    const sw = normalizeHistory({ id: "3", type: "path_payment_strict_send", from: me, to: me, amount: "9.9", asset_type: "credit_alphanum4", asset_code: "USDC", source_amount: "100", source_asset_type: "native", created_at: "", transaction_hash: "h" }, me);
    expect(sw.direction).toBe("self");
    expect(sw.detail).toContain("100 XLM → 9.9 USDC");
  });
  it("maps Horizon result codes to friendly errors", () => {
    const e = { response: { data: { extras: { result_codes: { transaction: "tx_failed", operations: ["op_underfunded"] } } } } };
    expect(horizonError(e)).toBe("Insufficient balance");
  });
});

import { buildPayUri, parsePayUri } from "./sep7";
import { localSigner } from "./signer";

describe("SEP-7 payment requests", () => {
  it("round-trips a payment request", () => {
    const uri = buildPayUri({ destination: dest, amount: "12.5", assetCode: "USDC", assetIssuer: USDC.split(":")[1], memo: "inv 42" });
    expect(uri.startsWith("web+stellar:pay?")).toBe(true);
    const p = parsePayUri(uri);
    expect(p).toMatchObject({ destination: dest, amount: "12.5", assetCode: "USDC", memo: "inv 42", memoType: "text" });
  });
  it("accepts bare addresses and rejects junk", () => {
    expect(parsePayUri(dest).destination).toBe(dest);
    expect(() => parsePayUri("hello")).toThrow();
    expect(() => parsePayUri("web+stellar:pay?destination=GBAD")).toThrow();
  });
  it("mainnet USDC/EURC issuers are valid", () => {
    for (const k of ["GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN", "GDHU6WRG4IEQXM5NZ4BMPKOXHW76MZM4Y2IEMFDVXBSDP6SJY4ITNPP2"]) {
      expect(StrKey.isValidEd25519PublicKey(k)).toBe(true);
    }
  });
});

describe("local signer", () => {
  it("signs transaction XDR", async () => {
    const s = localSigner(kp.secret());
    const tx = buildTx(new Account(kp.publicKey(), "1"), paymentOps(dest, Asset.native(), "1", true));
    const signed = new Transaction(await s.sign(tx.toXDR()), NETWORK.passphrase);
    expect(signed.signatures.length).toBe(1);
    expect(s.publicKey).toBe(kp.publicKey());
  });
});
