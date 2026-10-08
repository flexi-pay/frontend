import { NETWORK } from "../lib/config";
import { fundWithFriendbot, spendableXlm, type AccountState, type HistoryItem } from "../lib/stellar";
import { type PayRequest } from "../lib/sep7";
import type { Signer } from "../lib/signer";
import { Icon } from "./Icon";
import { Card, Notice, fmt, short, useAction } from "./ui";

export type Tab = "Home" | "Send" | "Receive" | "Scan" | "Convert" | "Cash" | "Escrow" | "Assets" | "Activity" | "Settings";

export interface WalletCtx {
  signer: Signer;
  state: AccountState | null;
  history: HistoryItem[];
  historyLoading: boolean;
  refresh: () => Promise<void>;
  go: (tab: Tab, prefill?: PayRequest) => void;
  prefill?: PayRequest;
}

export const txLink = (hash: string) => (
  <a href={`${NETWORK.explorer}/tx/${hash}`} target="_blank" rel="noreferrer">View transaction ↗</a>
);

const assetLabel = (id: string) => (id === "XLM" ? "XLM" : id.split(":")[0]);

// ---------------- Home ----------------

export function Home({ ctx }: { ctx: WalletCtx }) {
  const a = useAction();
  const s = ctx.state;
  const xlm = s?.balances.find((b) => b.isNative);
  const usd = s?.balances.filter((b) => ["USDC", "USDT", "EURC"].includes(b.code)).reduce((t, b) => t + parseFloat(b.balance), 0) ?? 0;

  return (
    <div className="stack">
      {s && !s.exists && (
        <Card title="Activate your account">
          <p className="muted">A Stellar account needs at least 1 XLM to exist on the network.{NETWORK.friendbotUrl ? " On testnet, get 10,000 free test XLM in one click." : " Receive XLM to this address to activate it."}</p>
          {NETWORK.friendbotUrl && (
            <button className="btn btn-primary" disabled={a.busy} onClick={() => a.run(async () => { await fundWithFriendbot(ctx.signer.publicKey); await ctx.refresh(); }, () => "Funded with 10,000 test XLM")}>
              {a.busy ? "Funding…" : "Get free test XLM"}
            </button>
          )}
          <Notice kind="error">{a.error}</Notice>
        </Card>
      )}
      <Notice kind="ok">{a.ok}</Notice>
      <div className="balance-card">
        <div className="between"><span className="muted small">XLM balance</span>{NETWORK.name === "testnet" && <span className="pill warn">Testnet</span>}</div>
        <div className="big">{xlm ? fmt(xlm.balance, 4) : s?.exists === false ? "0" : "—"} <span className="muted" style={{ fontSize: "1rem" }}>XLM</span></div>
        {usd > 0 && <div className="muted">+ {fmt(usd, 2)} in stablecoins</div>}
        {s?.exists && <div className="muted small">Spendable after reserves: {fmt(spendableXlm(s), 4)} XLM</div>}
        <div className="quick">
          {([["Send", "send"], ["Receive", "receive"], ["Scan", "scan"], ["Convert", "swap"], ["Cash", "bank"], ["Assets", "assets"]] as const).map(([t, ic]) => (
            <button key={t} onClick={() => ctx.go(t)}><span className="qi"><Icon name={ic} size={18} /></span>{t === "Cash" ? "Cash in/out" : t}</button>
          ))}
        </div>
      </div>
      <div className="cols">
        <Card title="Assets" actions={<button className="btn btn-ghost btn-sm" onClick={() => ctx.refresh()}>Refresh</button>}>
          {!s ? <p className="muted">Loading…</p> : !s.balances.length ? <p className="empty">No assets yet</p> : (
            <ul className="list">
              {s.balances.map((b) => (
                <li key={b.id}>
                  <span className="coin">{b.code.slice(0, 4)}</span>
                  <div className="grow"><b>{b.code}</b><div className="muted small">{b.isNative ? "Stellar Lumens" : short(b.issuer, 4)}</div></div>
                  <span className="amount">{fmt(b.balance, 4)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="Recent activity" actions={<button className="btn btn-ghost btn-sm" onClick={() => ctx.go("Activity")}>See all</button>}>
          <HistoryList items={ctx.history.slice(0, 5)} loading={ctx.historyLoading} />
        </Card>
      </div>
    </div>
  );
}

// ---------------- Activity ----------------

export function HistoryList({ items, loading }: { items: HistoryItem[]; loading: boolean }) {
  if (loading && !items.length) return <p className="muted">Loading…</p>;
  if (!items.length) return <p className="empty">No activity yet</p>;
  return (
    <ul className="list">
      {items.map((h) => (
        <li key={h.id}>
          <span className={`dir ${h.direction}`}><Icon name={h.direction === "in" ? "receive" : h.direction === "out" ? "send" : "swap"} size={16} /></span>
          <div className="grow">
            <div>{h.detail ?? (h.direction === "in" ? "Received" : h.direction === "out" ? "Sent" : "Self")}</div>
            <small className="muted">
              {h.direction !== "self" && <span className="mono">{h.direction === "in" ? "from" : "to"} {short(h.counterparty, 4)} · </span>}
              {new Date(h.createdAt).toLocaleDateString()} · <a href={`${NETWORK.explorer}/tx/${h.txHash}`} target="_blank" rel="noreferrer">tx ↗</a>
            </small>
          </div>
          {h.amount && <span className={`amount ${h.direction}`}>{h.direction === "out" ? "−" : h.direction === "in" ? "+" : ""}{fmt(h.amount, 4)} {h.asset}</span>}
        </li>
      ))}
    </ul>
  );
}

export function Activity({ ctx }: { ctx: WalletCtx }) {
  return (
    <div className="center-wrap">
      <Card title="Activity" actions={<button className="btn btn-ghost btn-sm" onClick={() => ctx.refresh()}>Refresh</button>}>
        <HistoryList items={ctx.history} loading={ctx.historyLoading} />
      </Card>
    </div>
  );
}
