// Client for the Starling Soroban escrow contract (contracts/escrow, written in Rust).
import {
  Account,
  Address,
  BASE_FEE,
  Operation,
  TransactionBuilder,
  nativeToScVal,
  rpc,
  scValToNative,
  xdr,
} from "@stellar/stellar-sdk";
import { ESCROW_CONTRACT_ID, NETWORK } from "./config";
import type { Signer } from "./signer";
import { parseAsset } from "./stellar";

export type EscrowStatus = "Funded" | "Released" | "Refunded";

export interface EscrowRecord {
  id: number;
  buyer: string;
  seller: string;
  token: string;
  amount: string; // decimal string (7 dp)
  deadline: number; // unix seconds
  createdAt: number;
  status: EscrowStatus;
  memo: string;
}

const STROOPS = 10_000_000n;

export const escrowEnabled = () => !!ESCROW_CONTRACT_ID && !!NETWORK.sorobanRpcUrl;

let _rpc: rpc.Server | null = null;
const server = () => (_rpc ??= new rpc.Server(NETWORK.sorobanRpcUrl, { allowHttp: NETWORK.sorobanRpcUrl.startsWith("http://") }));

/** Stellar Asset Contract address for a classic asset ("XLM" or "CODE:ISSUER"). */
export function tokenContractId(assetId: string): string {
  return parseAsset(assetId).contractId(NETWORK.passphrase);
}

export function toStroops(amount: string): bigint {
  if (!/^\d+(\.\d{1,7})?$/.test(amount)) throw new Error("Amount must be a positive number with up to 7 decimals");
  const [whole, frac = ""] = amount.split(".");
  const v = BigInt(whole) * STROOPS + BigInt(frac.padEnd(7, "0"));
  if (v <= 0n) throw new Error("Amount must be greater than zero");
  return v;
}

export function fromStroops(v: bigint): string {
  const neg = v < 0n;
  const a = neg ? -v : v;
  const s = `${a / STROOPS}.${(a % STROOPS).toString().padStart(7, "0")}`.replace(/\.?0+$/, "");
  return (neg ? "-" : "") + s;
}

// ----- argument builders (pure, unit-tested) -----

export function createArgs(p: { buyer: string; seller: string; token: string; amount: string; deadline: number; memo: string }): xdr.ScVal[] {
  if (new TextEncoder().encode(p.memo).length > 64) throw new Error("Note must be 64 characters or fewer");
  return [
    new Address(p.buyer).toScVal(),
    new Address(p.seller).toScVal(),
    new Address(p.token).toScVal(),
    nativeToScVal(toStroops(p.amount), { type: "i128" }),
    nativeToScVal(BigInt(p.deadline), { type: "u64" }),
    nativeToScVal(p.memo, { type: "string" }),
  ];
}

export function decodeEscrow(v: unknown): EscrowRecord {
  const o = v as Record<string, unknown>;
  const status = Array.isArray(o.status) ? String(o.status[0]) : String(o.status);
  return {
    id: Number(o.id),
    buyer: String(o.buyer),
    seller: String(o.seller),
    token: String(o.token),
    amount: fromStroops(BigInt(o.amount as bigint)),
    deadline: Number(o.deadline),
    createdAt: Number(o.created_at),
    status: status as EscrowStatus,
    memo: String(o.memo ?? ""),
  };
}

const CONTRACT_ERRORS: Record<number, string> = {
  1: "Escrow not found",
  2: "Amount must be greater than zero",
  3: "Deadline must be in the future",
  4: "This escrow is already settled",
  5: "Only the buyer or seller can do that",
  6: "The buyer can only refund after the deadline",
  7: "Buyer and seller must be different",
  8: "Note is too long",
};

export function friendlyContractError(msg: string): string {
  const m = msg.match(/Error\(Contract, #(\d+)\)/);
  if (m) return CONTRACT_ERRORS[Number(m[1])] ?? `Contract error #${m[1]}`;
  if (/balance is not sufficient|resulting balance is not within/i.test(msg)) return "Insufficient balance";
  if (/trustline entry is missing/i.test(msg)) return "The recipient can't hold this asset yet (no trustline)";
  return msg.length > 220 ? msg.slice(0, 220) + "…" : msg;
}

// ----- RPC helpers -----

function op(fn: string, args: xdr.ScVal[]) {
  return Operation.invokeContractFunction({ contract: ESCROW_CONTRACT_ID, function: fn, args });
}

/** Read-only call via simulation (no signature, no fee). */
async function read(fn: string, args: xdr.ScVal[], source: string) {
  const acc = new Account(source, "0");
  const tx = new TransactionBuilder(acc, { fee: BASE_FEE, networkPassphrase: NETWORK.passphrase })
    .addOperation(op(fn, args)).setTimeout(30).build();
  const sim = await server().simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim)) throw new Error(friendlyContractError(sim.error));
  return sim.result?.retval ? scValToNative(sim.result.retval) : undefined;
}

/** State-changing call: simulate → assemble → sign → send → wait. */
async function invoke(signer: Signer, fn: string, args: xdr.ScVal[]) {
  const s = server();
  const source = await s.getAccount(signer.publicKey);
  const tx = new TransactionBuilder(source, { fee: BASE_FEE, networkPassphrase: NETWORK.passphrase })
    .addOperation(op(fn, args)).setTimeout(120).build();
  let prepared;
  try {
    prepared = await s.prepareTransaction(tx);
  } catch (e) {
    throw new Error(friendlyContractError(e instanceof Error ? e.message : String(e)));
  }
  const signedXdr = await signer.sign(prepared.toXDR());
  const sent = await s.sendTransaction(TransactionBuilder.fromXDR(signedXdr, NETWORK.passphrase));
  if (sent.status === "ERROR") throw new Error("Network rejected the transaction");
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    const res = await s.getTransaction(sent.hash);
    if (res.status === rpc.Api.GetTransactionStatus.SUCCESS) {
      return { hash: sent.hash, value: res.returnValue ? scValToNative(res.returnValue) : undefined };
    }
    if (res.status === rpc.Api.GetTransactionStatus.FAILED) throw new Error("Contract call failed on-chain");
  }
  throw new Error("Timed out waiting for confirmation — check the explorer");
}

// ----- Public API -----

export async function createEscrow(
  signer: Signer,
  p: { seller: string; assetId: string; amount: string; deadline: number; memo: string },
) {
  const args = createArgs({ buyer: signer.publicKey, seller: p.seller, token: tokenContractId(p.assetId), amount: p.amount, deadline: p.deadline, memo: p.memo });
  const r = await invoke(signer, "create", args);
  return { hash: r.hash, id: Number(r.value) };
}

export const releaseEscrow = (signer: Signer, id: number) =>
  invoke(signer, "release", [nativeToScVal(BigInt(id), { type: "u64" })]);

export const refundEscrow = (signer: Signer, id: number) =>
  invoke(signer, "refund", [nativeToScVal(BigInt(id), { type: "u64" }), new Address(signer.publicKey).toScVal()]);

export async function listEscrows(viewer: string, limit = 50): Promise<EscrowRecord[]> {
  const raw = (await read("list", [nativeToScVal(0n, { type: "u64" }), nativeToScVal(limit, { type: "u32" })], viewer)) as unknown[] | undefined;
  return (raw ?? []).map(decodeEscrow);
}

/** Map token contract ids back to readable asset codes for the user's known assets. */
export function tokenLabel(tokenId: string, knownAssetIds: string[]): string {
  for (const id of ["XLM", ...knownAssetIds]) {
    try { if (tokenContractId(id) === tokenId) return id === "XLM" ? "XLM" : id.split(":")[0]; } catch { /* skip */ }
  }
  return `${tokenId.slice(0, 4)}…${tokenId.slice(-4)}`;
}

