import { describe, expect, it } from "vitest";
import { Keypair, nativeToScVal, scValToNative, xdr, Address } from "@stellar/stellar-sdk";
import { createArgs, decodeEscrow, friendlyContractError, fromStroops, toStroops, tokenContractId } from "./escrow";

const buyer = Keypair.random().publicKey();
const seller = Keypair.random().publicKey();

describe("escrow client", () => {
  it("converts amounts to and from stroops exactly", () => {
    expect(toStroops("1")).toBe(10_000_000n);
    expect(toStroops("12.3456789")).toBe(123_456_789n);
    expect(fromStroops(123_456_789n)).toBe("12.3456789");
    expect(fromStroops(10_000_000n)).toBe("1");
    expect(() => toStroops("0")).toThrow();
    expect(() => toStroops("1.12345678")).toThrow();
  });

  it("resolves the native XLM Stellar Asset Contract on testnet", () => {
    expect(tokenContractId("XLM")).toBe("CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC");
    expect(tokenContractId("USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5")).toMatch(/^C[A-Z0-9]{55}$/);
  });

  it("encodes create() arguments with the contract's types", () => {
    const token = tokenContractId("XLM");
    const args = createArgs({ buyer, seller, token, amount: "2.5", deadline: 1_900_000_000, memo: "Phone" });
    expect(args.map((a) => String((a as unknown as { type: unknown }).type))).toEqual(["scvAddress", "scvAddress", "scvAddress", "scvI128", "scvU64", "scvString"]);
    expect(scValToNative(args[3])).toBe(25_000_000n);
    expect(Address.fromScVal(args[2]).toString()).toBe(token);
    expect(() => createArgs({ buyer, seller, token, amount: "1", deadline: 1, memo: "x".repeat(65) })).toThrow();
  });

  it("decodes an Escrow struct returned by the contract", () => {
    const token = tokenContractId("XLM");
    const sym = (s: string) => xdr.ScVal.scvSymbol(s);
    // Soroban #[contracttype] structs are ScMaps with symbol keys in sorted order
    const entries: [string, xdr.ScVal][] = [
      ["amount", nativeToScVal(25_000_000n, { type: "i128" })],
      ["buyer", new Address(buyer).toScVal()],
      ["created_at", nativeToScVal(1000n, { type: "u64" })],
      ["deadline", nativeToScVal(2000n, { type: "u64" })],
      ["id", nativeToScVal(3n, { type: "u64" })],
      ["memo", nativeToScVal("Phone", { type: "string" })],
      ["seller", new Address(seller).toScVal()],
      ["status", xdr.ScVal.scvVec([sym("Funded")])],
      ["token", new Address(token).toScVal()],
    ];
    const v = xdr.ScVal.scvMap(entries.map(([k, val]) => new xdr.ScMapEntry({ key: sym(k), val })));
    const e = decodeEscrow(scValToNative(v));
    expect(e).toMatchObject({ id: 3, buyer, seller, token, amount: "2.5", deadline: 2000, createdAt: 1000, status: "Funded", memo: "Phone" });
  });

  it("maps contract error codes to friendly text", () => {
    expect(friendlyContractError("HostError: Error(Contract, #6)")).toMatch(/after the deadline/);
    expect(friendlyContractError("Error(Contract, #99)")).toBe("Contract error #99");
  });
});
