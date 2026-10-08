import { useEffect, useRef, useState } from "react";
import { NETWORK } from "../lib/config";
import { connectAnchor, getAnchorTx, startInteractive, type AnchorSession, type AnchorTx } from "../lib/anchor";
import { changeTrust, sendPayment } from "../lib/stellar";
import { isPopup, openFullTab } from "../lib/platform";
import { Icon } from "./Icon";
import { Card, Field, Notice, useAction } from "./ui";
import type { WalletCtx } from "./Screens";

interface Tracked { id: string; kind: "deposit" | "withdraw"; asset: string; tx?: AnchorTx; paid?: boolean }

const FINAL = ["completed", "refunded", "expired", "error", "no_market", "too_small", "too_large"];
const STATUS_TEXT: Record<string, string> = {
  incomplete: "Waiting for you to finish the form",
  pending_user_transfer_start: "Waiting for your payment",
  pending_user_transfer_complete: "Payment received by anchor",
  pending_external: "Processing with the bank",
  pending_anchor: "Anchor is processing",
  pending_stellar: "Sending on Stellar",
  pending_trust: "Waiting for trustline",
  pending_user: "Action needed — check the anchor",
  completed: "Completed",
  refunded: "Refunded",
  expired: "Expired",
  error: "Failed",
};

export function AnchorScreen({ ctx }: { ctx: WalletCtx }) {
  const [domain, setDomain] = useState(NETWORK.defaultAnchor);
  const [session, setSession] = useState<AnchorSession | null>(null);
  const [kind, setKind] = useState<"deposit" | "withdraw">("deposit");
  const [amount, setAmount] = useState("");
  const [tracked, setTracked] = useState<Tracked[]>([]);
  const a = useAction();
  const refresh = ctx.refresh;
  const trackedRef = useRef(tracked);
  trackedRef.current = tracked;

  useEffect(() => {
    if (!session) return;
    const t = setInterval(async () => {
      const open = trackedRef.current.filter((x) => !x.tx || !FINAL.includes(x.tx.status));
      if (!open.length) return;
      const updates = await Promise.all(open.map((x) => getAnchorTx(session, x.id).catch(() => undefined)));
      setTracked((prev) => prev.map((x) => {
        const i = open.findIndex((o) => o.id === x.id);
        return i >= 0 && updates[i] ? { ...x, tx: updates[i] } : x;
      }));
      if (updates.some((u) => u?.status === "completed")) refresh();
    }, 5000);
    return () => clearInterval(t);
  }, [session, refresh]);

  if (isPopup) {
    return (
      <Card title="Cash in & out">
        <p className="muted small">The anchor's form opens in a new window, which would close this popup. Open the wallet in a tab to continue.</p>
        <button className="btn btn-primary" onClick={() => openFullTab("Cash")}><Icon name="expand" size={16} /> Open in a tab</button>
      </Card>
    );
  }

  const busyText = ctx.signer.kind === "external" ? "Confirm in your wallet…" : "Working…";
  const connect = () => a.run(async () => setSession(await connectAnchor(domain.trim(), ctx.signer)), () => "Connected and signed in to the anchor");

  const start = (code: string) =>
    a.run(async () => {
      if (!session) return;
      const popup = window.open("about:blank", "anchor", "width=500,height=760");
      try {
        const { id, url } = await startInteractive(session, kind, code, ctx.signer.publicKey, amount || undefined);
        if (popup) popup.location.href = url; else window.open(url, "_blank");
        setTracked((p) => [{ id, kind, asset: code }, ...p]);
      } catch (e) {
        popup?.close();
        throw e;
      }
    }, () => "Complete the steps in the anchor's window. Status updates below.");

  const completeWithdrawal = (t: Tracked) =>
    a.run(async () => {
      const tx = t.tx!;
      const asset = session!.assets.find((x) => x.code === t.asset)!;
      if (!tx.withdraw_anchor_account || !tx.amount_in) throw new Error("The anchor hasn't provided payment details yet");
      if (!confirm(`Send ${tx.amount_in} ${asset.code} to the anchor to complete this withdrawal?`)) throw new Error("Cancelled");
      const r = await sendPayment(ctx.signer, tx.withdraw_anchor_account, `${asset.code}:${asset.issuer}`, tx.amount_in,
        tx.withdraw_memo ? { type: tx.withdraw_memo_type ?? "text", value: tx.withdraw_memo } : undefined);
      setTracked((p) => p.map((x) => (x.id === t.id ? { ...x, paid: true } : x)));
      await ctx.refresh();
      return r;
    }, () => "Payment sent to the anchor. The status will update shortly.");

  const hasTrust = (code: string, issuer: string) => ctx.state?.balances.some((b) => b.id === `${code}:${issuer}`);
  const assets = session?.assets.filter((x) => (kind === "deposit" ? x.deposit : x.withdraw)) ?? [];

  return (
    <div className="center-wrap stack">
      <Card title="Cash in & out">
        <p className="muted small">
          Anchors are regulated companies that move money between bank accounts and Stellar (SEP-24).
          {NETWORK.name === "testnet" ? " testanchor.stellar.org is Stellar's official test anchor — no real money moves." : " Enter the domain of an anchor that serves your country and currency."}
        </p>
        <Field label="Anchor">
          <div className="row">
            <input value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="anchor.example.com" />
            <button className="btn btn-primary btn-sm" disabled={a.busy || !domain || !ctx.state?.exists} onClick={connect}>{a.busy && !session ? busyText : session ? "Reconnect" : "Connect"}</button>
          </div>
        </Field>
        {!ctx.state?.exists && <Notice kind="info">Activate your account first (Home).</Notice>}
        <Notice kind="error">{a.error}</Notice>
        <Notice kind="ok">{a.ok}</Notice>
      </Card>

      {session && (
        <Card title={session.homeDomain}>
          <div className="seg">
            <button className={kind === "deposit" ? "on" : ""} onClick={() => setKind("deposit")}>Cash in</button>
            <button className={kind === "withdraw" ? "on" : ""} onClick={() => setKind("withdraw")}>Cash out</button>
          </div>
          <Field label="Amount (optional — you can also enter it in the anchor's form)">
            <input inputMode="decimal" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value.trim())} />
          </Field>
          {!assets.length && <p className="empty">This anchor has no assets for {kind === "deposit" ? "cash in" : "cash out"}.</p>}
          <ul className="list">
            {assets.map((as) => (
              <li key={as.code}>
                <span className="coin">{as.code.slice(0, 4)}</span>
                <div className="grow"><b>{as.code}</b><div className="muted small">Fee: {(kind === "deposit" ? as.depositFee : as.withdrawFee) ?? "shown by anchor"}</div></div>
                {!hasTrust(as.code, as.issuer) ? (
                  <button className="btn btn-ghost btn-sm" disabled={a.busy} onClick={() => a.run(async () => { await changeTrust(ctx.signer, `${as.code}:${as.issuer}`); await ctx.refresh(); }, () => `${as.code} added to your wallet`)}>Add {as.code} first</button>
                ) : (
                  <button className="btn btn-primary btn-sm" disabled={a.busy} onClick={() => start(as.code)}>{kind === "deposit" ? "Cash in" : "Cash out"}</button>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {tracked.length > 0 && (
        <Card title="Your transfers">
          <ul className="list">
            {tracked.map((t) => (
              <li key={t.id}>
                <span className={`dir ${t.kind === "deposit" ? "in" : "out"}`}><Icon name={t.kind === "deposit" ? "receive" : "send"} size={16} /></span>
                <div className="grow">
                  <div><b>{t.kind === "deposit" ? "Cash in" : "Cash out"} {t.asset}</b> <span className={`status ${t.tx?.status ?? ""}`}>{STATUS_TEXT[t.tx?.status ?? "incomplete"] ?? t.tx?.status}</span></div>
                  <small className="muted">
                    {t.tx?.amount_in && <>In {t.tx.amount_in} · </>}{t.tx?.amount_out && <>Out {t.tx.amount_out} · </>}{t.tx?.amount_fee && <>Fee {t.tx.amount_fee} · </>}
                    {t.tx?.more_info_url && <a href={t.tx.more_info_url} target="_blank" rel="noreferrer">details ↗</a>}
                  </small>
                  {t.tx?.message && <div className="muted small">{t.tx.message}</div>}
                </div>
                {t.kind === "withdraw" && t.tx?.status === "pending_user_transfer_start" && !t.paid && (
                  <button className="btn btn-primary btn-sm" disabled={a.busy} onClick={() => completeWithdrawal(t)}>Pay {t.tx.amount_in}</button>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
