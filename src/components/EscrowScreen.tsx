import { useCallback, useEffect, useState } from "react";
import { StrKey } from "@stellar/stellar-sdk";
import { ESCROW_CONTRACT_ID, NETWORK } from "../lib/config";
import {
  createEscrow, escrowEnabled, friendlyContractError, listEscrows, refundEscrow, releaseEscrow, tokenLabel,
  type EscrowRecord,
} from "../lib/escrow";
import { Icon } from "./Icon";
import { Card, Field, Notice, fmt, short, useAction } from "./ui";
import type { WalletCtx } from "./Screens";

const txLink = (hash: string) => <a href={`${NETWORK.explorer}/tx/${hash}`} target="_blank" rel="noreferrer">View transaction ↗</a>;

export function EscrowScreen({ ctx }: { ctx: WalletCtx }) {
  if (!escrowEnabled()) return <NotDeployed />;
  return <EscrowApp ctx={ctx} />;
}

function NotDeployed() {
  return (
    <div className="center-wrap stack">
      <Card title="Safe pay (escrow)">
        <p className="muted">Safe pay uses Starling's Soroban smart contract, written in Rust. It needs to be deployed once before it can be used.</p>
        <ol className="muted small" style={{ lineHeight: 1.8, paddingLeft: 18, margin: 0 }}>
          <li>Clone <a href="https://github.com/flexi-pay/contracts" target="_blank" rel="noreferrer">flexi-pay/contracts</a> and install Rust + the Stellar CLI.</li>
          <li>Run <code>./scripts/deploy.sh</code>. It builds, deploys to {NETWORK.name} and prints the contract ID.</li>
          <li>Put the contract ID in <code>.env</code> as <code>VITE_ESCROW_CONTRACT_ID=C…</code> and rebuild.</li>
        </ol>
        {!NETWORK.sorobanRpcUrl && <Notice kind="info">Also set VITE_SOROBAN_RPC_URL — there's no public SDF RPC on mainnet.</Notice>}
      </Card>
    </div>
  );
}

function EscrowApp({ ctx }: { ctx: WalletCtx }) {
  const me = ctx.signer.publicKey;
  const balances = ctx.state?.balances ?? [];
  const known = balances.filter((b) => !b.isNative).map((b) => b.id);
  const [seller, setSeller] = useState("");
  const [asset, setAsset] = useState("XLM");
  const [amount, setAmount] = useState("");
  const [days, setDays] = useState(7);
  const [memo, setMemo] = useState("");
  const [items, setItems] = useState<EscrowRecord[] | null>(null);
  const [listErr, setListErr] = useState("");
  const a = useAction();
  const busyText = ctx.signer.kind === "external" ? "Confirm in your wallet…" : "Working…";

  const load = useCallback(async () => {
    try {
      const all = await listEscrows(me);
      setItems(all.filter((e) => e.buyer === me || e.seller === me));
      setListErr("");
    } catch (e) {
      setListErr(friendlyContractError(e instanceof Error ? e.message : String(e)));
      setItems([]);
    }
  }, [me]);
  useEffect(() => { load(); }, [load]);

  const create = () =>
    a.run(async () => {
      if (!StrKey.isValidEd25519PublicKey(seller.trim())) throw new Error("Enter a valid seller address (G…)");
      if (seller.trim() === me) throw new Error("You can't open an escrow with yourself");
      const deadline = Math.floor(Date.now() / 1000) + days * 86_400;
      const r = await createEscrow(ctx.signer, { seller: seller.trim(), assetId: asset, amount, deadline, memo });
      setAmount(""); setMemo(""); setSeller("");
      await Promise.all([load(), ctx.refresh()]);
      return r;
    }, (r) => <>Escrow #{r.id} funded. {txLink(r.hash)}</>);

  const act = (kind: "release" | "refund", e: EscrowRecord) =>
    a.run(async () => {
      const q = kind === "release" ? `Release ${e.amount} to the seller? This can't be undone.` : `Refund ${e.amount} to the buyer?`;
      if (!confirm(q)) throw new Error("Cancelled");
      const r = kind === "release" ? await releaseEscrow(ctx.signer, e.id) : await refundEscrow(ctx.signer, e.id);
      await Promise.all([load(), ctx.refresh()]);
      return r;
    }, (r) => <>{kind === "release" ? "Released to seller" : "Refunded to buyer"}. {txLink(r.hash)}</>);

  const now = Date.now() / 1000;

  return (
    <div className="center-wrap stack">
      <Card title="Safe pay (escrow)">
        <p className="muted small">Pay a seller safely: your money is locked in a Soroban smart contract until you confirm you got what you paid for. The seller can refund you any time, and if they never deliver you can take it back after the deadline.</p>
        <Field label="Seller's address"><input placeholder="G…" value={seller} onChange={(e) => setSeller(e.target.value)} /></Field>
        <div className="grid2">
          <Field label="Asset">
            <select value={asset} onChange={(e) => setAsset(e.target.value)}>
              {balances.length ? balances.map((b) => <option key={b.id} value={b.id}>{b.code}</option>) : <option value="XLM">XLM</option>}
            </select>
          </Field>
          <Field label="Amount"><input inputMode="decimal" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value.trim())} /></Field>
        </div>
        <div className="grid2">
          <Field label="Refund deadline">
            <select value={days} onChange={(e) => setDays(Number(e.target.value))}>
              {[1, 3, 7, 14, 30].map((d) => <option key={d} value={d}>{d} day{d > 1 ? "s" : ""}</option>)}
            </select>
          </Field>
          <Field label="What's it for? (optional)"><input maxLength={64} value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="e.g. iPhone 13" /></Field>
        </div>
        <Notice kind="error">{a.error}</Notice>
        <Notice kind="ok">{a.ok}</Notice>
        <button className="btn btn-primary btn-block" disabled={a.busy || !seller || !amount || !ctx.state?.exists} onClick={create}>
          <Icon name="shield" size={16} /> {a.busy ? busyText : "Lock funds in escrow"}
        </button>
        <p className="muted small">Contract <a href={`${NETWORK.explorer}/contract/${ESCROW_CONTRACT_ID}`} target="_blank" rel="noreferrer" className="mono">{short(ESCROW_CONTRACT_ID, 6)} ↗</a></p>
      </Card>

      <Card title="Your escrows" actions={<button className="btn btn-ghost btn-sm" onClick={load}>Refresh</button>}>
        {items === null ? <p className="muted">Loading…</p> : listErr ? <Notice kind="error">{listErr}</Notice> : !items.length ? <p className="empty">No escrows yet</p> : (
          <ul className="list">
            {items.map((e) => {
              const iAmBuyer = e.buyer === me;
              const label = tokenLabel(e.token, known);
              const canRelease = iAmBuyer && e.status === "Funded";
              const canRefund = e.status === "Funded" && (!iAmBuyer || now >= e.deadline);
              return (
                <li key={e.id}>
                  <span className={`dir ${iAmBuyer ? "out" : "in"}`}><Icon name="shield" size={16} /></span>
                  <div className="grow">
                    <div><b>#{e.id} {e.memo || (iAmBuyer ? "Payment" : "Sale")}</b> <span className={`status ${e.status === "Released" ? "completed" : e.status === "Refunded" ? "expired" : ""}`}>{e.status}</span></div>
                    <small className="muted">
                      {iAmBuyer ? "To" : "From"} <span className="mono">{short(iAmBuyer ? e.seller : e.buyer, 4)}</span> · deadline {new Date(e.deadline * 1000).toLocaleDateString()}
                    </small>
                  </div>
                  <span className="amount">{fmt(e.amount, 4)} {label}</span>
                  {canRelease && <button className="btn btn-primary btn-sm" disabled={a.busy} onClick={() => act("release", e)}>Release</button>}
                  {canRefund && <button className="btn btn-ghost btn-sm" disabled={a.busy} onClick={() => act("refund", e)}>Refund</button>}
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
