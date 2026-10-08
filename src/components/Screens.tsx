import { useEffect, useMemo, useRef, useState } from "react";
import QRCode from "qrcode";
import jsQR from "jsqr";
import { NETWORK } from "../lib/config";
import {
  fundWithFriendbot,
  sendPayment,
  spendableXlm,
  type AccountState,
  type HistoryItem,
  type MemoInput,
} from "../lib/stellar";
import { buildPayUri, parsePayUri, type PayRequest } from "../lib/sep7";
import type { Signer } from "../lib/signer";
import { Icon } from "./Icon";
import { Card, Copy, Field, Notice, fmt, short, useAction } from "./ui";

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

// ---------------- Send ----------------

export function Send({ ctx }: { ctx: WalletCtx }) {
  const p = ctx.prefill;
  const balances = ctx.state?.balances ?? [];
  const prefAsset = p?.assetCode && p.assetCode !== "XLM" ? `${p.assetCode}:${p.assetIssuer}` : "XLM";
  const [to, setTo] = useState(p?.destination ?? "");
  const [asset, setAsset] = useState(prefAsset);
  const [amount, setAmount] = useState(p?.amount ?? "");
  const [memo, setMemo] = useState<MemoInput>({ type: p?.memo ? p.memoType ?? "text" : "none", value: p?.memo ?? "" });
  const [review, setReview] = useState(false);
  const a = useAction();
  const bal = balances.find((b) => b.id === asset);
  const max = asset === "XLM" && ctx.state ? spendableXlm(ctx.state).toFixed(7) : bal?.balance;
  const missingTrust = asset !== "XLM" && !bal;

  const go = () =>
    a.run(async () => {
      if (to.trim() === ctx.signer.publicKey) throw new Error("You can't send to yourself");
      const r = await sendPayment(ctx.signer, to.trim(), asset, amount, memo);
      setAmount(""); setReview(false);
      await ctx.refresh();
      return r;
    }, (r) => <>Sent {amount} {assetLabel(asset)}. {txLink(r.hash)}</>);

  return (
    <div className="center-wrap stack">
      <Card title="Send money">
        {p?.msg && <Notice kind="info">Payment request: “{p.msg}”</Notice>}
        <Field label="To (Stellar address)">
          <div className="row">
            <input placeholder="G…" value={to} onChange={(e) => { setTo(e.target.value); setReview(false); }} />
            <button className="btn btn-ghost btn-sm" onClick={() => ctx.go("Scan")}><Icon name="scan" size={14} /> Scan</button>
          </div>
        </Field>
        <div className="grid2">
          <Field label="Asset">
            <select value={asset} onChange={(e) => { setAsset(e.target.value); setReview(false); }}>
              {balances.map((b) => <option key={b.id} value={b.id}>{b.code}{b.issuer ? ` (${short(b.issuer, 4)})` : ""}</option>)}
              {!balances.some((b) => b.id === asset) && <option value={asset}>{assetLabel(asset)}</option>}
            </select>
          </Field>
          <Field label="Amount" hint={max && <>Available: <button type="button" className="link" onClick={() => setAmount(String(Number(max)))}>{fmt(max)}</button></>}>
            <input inputMode="decimal" placeholder="0.00" value={amount} onChange={(e) => { setAmount(e.target.value.trim()); setReview(false); }} />
          </Field>
        </div>
        <div className="grid2">
          <Field label="Memo type" hint="Exchanges usually require one">
            <select value={memo.type} onChange={(e) => setMemo({ ...memo, type: e.target.value as MemoInput["type"] })}>
              <option value="none">None</option><option value="text">Text</option><option value="id">ID</option><option value="hash">Hash</option>
            </select>
          </Field>
          <Field label="Memo"><input disabled={memo.type === "none"} value={memo.value} onChange={(e) => setMemo({ ...memo, value: e.target.value })} /></Field>
        </div>
        {missingTrust && <Notice kind="info">You don't hold {assetLabel(asset)} yet. Add it under Assets first.</Notice>}
        {review && (
          <div className="quote">
            <div className="between"><span className="muted">You send</span><b>{amount} {assetLabel(asset)}</b></div>
            <div className="between"><span className="muted">To</span><span className="mono small">{short(to.trim(), 8)}</span></div>
            {memo.type !== "none" && memo.value && <div className="between"><span className="muted">Memo</span><span>{memo.value}</span></div>}
            <div className="between"><span className="muted">Network fee</span><span>~0.00001 XLM</span></div>
          </div>
        )}
        <Notice kind="error">{a.error}</Notice>
        <Notice kind="ok">{a.ok}</Notice>
        {!review ? (
          <button className="btn btn-primary btn-block" disabled={!to || !amount || !ctx.state?.exists || missingTrust} onClick={() => { a.setError(""); setReview(true); }}>Review</button>
        ) : (
          <button className="btn btn-primary btn-block" disabled={a.busy} onClick={go}>{a.busy ? (ctx.signer.kind === "external" ? "Confirm in your wallet…" : "Sending…") : `Confirm & send`}</button>
        )}
      </Card>
    </div>
  );
}

// ---------------- Receive (SEP-7 payment request) ----------------

export function Receive({ ctx }: { ctx: WalletCtx }) {
  const balances = ctx.state?.balances ?? [];
  const [asset, setAsset] = useState("XLM");
  const [amount, setAmount] = useState("");
  const [memo, setMemo] = useState("");
  const [qr, setQr] = useState("");
  const b = balances.find((x) => x.id === asset);
  const uri = useMemo(() => {
    if (!amount && !memo && asset === "XLM") return ctx.signer.publicKey;
    return buildPayUri({ destination: ctx.signer.publicKey, amount: amount || undefined, assetCode: b?.code ?? "XLM", assetIssuer: b?.issuer, memo: memo || undefined });
  }, [amount, memo, asset, b, ctx.signer.publicKey]);
  useEffect(() => { QRCode.toDataURL(uri, { margin: 1, width: 440, errorCorrectionLevel: "M" }).then(setQr); }, [uri]);

  return (
    <div className="center-wrap stack">
      <Card title="Get paid">
        <p className="muted small">Show this code. Add an amount to create a payment request that any Stellar wallet (SEP-7) can scan and pay.</p>
        {qr && <div className="qr-box"><img src={qr} alt="Payment QR code" /></div>}
        <div className="grid2">
          <Field label="Asset">
            <select value={asset} onChange={(e) => setAsset(e.target.value)}>
              {balances.length ? balances.map((x) => <option key={x.id} value={x.id}>{x.code}</option>) : <option value="XLM">XLM</option>}
            </select>
          </Field>
          <Field label="Amount (optional)"><input inputMode="decimal" placeholder="Any amount" value={amount} onChange={(e) => setAmount(e.target.value.trim())} /></Field>
        </div>
        <Field label="Note / memo (optional)"><input maxLength={28} value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="e.g. Invoice 42" /></Field>
        <Field label="Your address"><code className="mono small">{ctx.signer.publicKey}</code></Field>
        <div className="row">
          <Copy text={ctx.signer.publicKey} label="Copy address" />
          {uri !== ctx.signer.publicKey && <Copy text={uri} label="Copy payment link" />}
          {"share" in navigator && <button className="btn btn-ghost btn-sm" onClick={() => navigator.share({ text: uri }).catch(() => {})}>Share</button>}
        </div>
      </Card>
    </div>
  );
}

// ---------------- Scan to pay ----------------

export function Scan({ ctx }: { ctx: WalletCtx }) {
  const video = useRef<HTMLVideoElement>(null);
  const [err, setErr] = useState("");
  const [active, setActive] = useState(false);
  const [paste, setPaste] = useState("");

  const handle = (text: string) => {
    try { ctx.go("Send", parsePayUri(text)); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
  };

  useEffect(() => {
    if (!active) return;
    let stream: MediaStream | undefined;
    let raf = 0;
    let stopped = false;
    const canvas = document.createElement("canvas");
    const g = canvas.getContext("2d", { willReadFrequently: true })!;
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        if (stopped) return;
        const v = video.current!;
        v.srcObject = stream;
        await v.play();
        const tick = () => {
          if (stopped) return;
          if (v.readyState === v.HAVE_ENOUGH_DATA) {
            canvas.width = v.videoWidth; canvas.height = v.videoHeight;
            g.drawImage(v, 0, 0);
            const code = jsQR(g.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height);
            if (code?.data) { stopped = true; handle(code.data); return; }
          }
          raf = requestAnimationFrame(tick);
        };
        tick();
      } catch (e) {
        setErr(`Camera unavailable: ${e instanceof Error ? e.message : e}. You can upload a photo of the code or paste it instead.`);
        setActive(false);
      }
    })();
    return () => { stopped = true; cancelAnimationFrame(raf); stream?.getTracks().forEach((t) => t.stop()); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  const fromImage = async (f?: File) => {
    if (!f) return;
    setErr("");
    const img = await createImageBitmap(f);
    const c = document.createElement("canvas");
    c.width = img.width; c.height = img.height;
    const g = c.getContext("2d")!;
    g.drawImage(img, 0, 0);
    const code = jsQR(g.getImageData(0, 0, c.width, c.height).data, c.width, c.height);
    if (code?.data) handle(code.data); else setErr("No QR code found in that image");
  };

  return (
    <div className="center-wrap stack">
      <Card title="Scan to pay">
        <p className="muted small">Scan a Stellar address or a payment request (SEP-7). You'll review everything before paying.</p>
        {active ? (
          <div className="scanner"><video ref={video} playsInline muted /><div className="frame" /></div>
        ) : (
          <button className="btn btn-primary btn-block" onClick={() => { setErr(""); setActive(true); }}><Icon name="scan" size={16} /> Open camera</button>
        )}
        {active && <button className="btn btn-ghost btn-block" onClick={() => setActive(false)}>Stop camera</button>}
        <label className="btn btn-ghost btn-block">
          Upload a photo of a code
          <input type="file" accept="image/*" hidden onChange={(e) => fromImage(e.target.files?.[0])} />
        </label>
        <Field label="…or paste an address / payment link">
          <div className="row"><input className="input" value={paste} onChange={(e) => setPaste(e.target.value)} placeholder="G… or web+stellar:pay?…" /><button className="btn btn-ghost btn-sm" disabled={!paste} onClick={() => handle(paste)}>Continue</button></div>
        </Field>
        <Notice kind="error">{err}</Notice>
      </Card>
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
