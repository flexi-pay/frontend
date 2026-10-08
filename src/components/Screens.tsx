import { useEffect, useMemo, useRef, useState } from "react";
import QRCode from "qrcode";
import jsQR from "jsqr";
import { NETWORK } from "../lib/config";
import {
  changeTrust, fundWithFriendbot, quoteSwap, sendPayment, spendableXlm, swap,
  type AccountState, type HistoryItem, type MemoInput, type SwapQuote,
} from "../lib/stellar";
import { buildPayUri, parsePayUri, type PayRequest } from "../lib/sep7";
import { isFederationAddress, myName, namesEnabled, resolveRecipient, type Resolved } from "../lib/names";
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
  const [resolved, setResolved] = useState<Resolved | null>(null);
  const a = useAction();
  const bal = balances.find((b) => b.id === asset);
  const max = asset === "XLM" && ctx.state ? spendableXlm(ctx.state).toFixed(7) : bal?.balance;
  const missingTrust = asset !== "XLM" && !bal;

  const go = () =>
    a.run(async () => {
      const dest = resolved?.accountId ?? to.trim();
      if (dest === ctx.signer.publicKey) throw new Error("You can't send to yourself");
      const r = await sendPayment(ctx.signer, dest, asset, amount, memo);
      setAmount(""); setReview(false); setResolved(null);
      await ctx.refresh();
      return r;
    }, (r) => <>Sent {amount} {assetLabel(asset)}. {txLink(r.hash)}</>);

  return (
    <div className="center-wrap stack">
      <Card title="Send money">
        {p?.msg && <Notice kind="info">Payment request: “{p.msg}”</Notice>}
        <Field label="To (Stellar address or name)" hint={namesEnabled() ? "e.g. G… or nuel*flexipay.app" : undefined}>
          <div className="row">
            <input placeholder="G… or name*domain" value={to} onChange={(e) => { setTo(e.target.value); setReview(false); setResolved(null); }} />
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
            <div className="between"><span className="muted">To</span><span className="mono small">{resolved?.stellarAddress && isFederationAddress(to) ? <>{resolved.stellarAddress} → {short(resolved.accountId, 6)}</> : short(resolved?.accountId ?? to.trim(), 8)}</span></div>
            {resolved?.memo && <div className="muted small">The recipient requires memo “{resolved.memo}” — added automatically.</div>}
            {memo.type !== "none" && memo.value && <div className="between"><span className="muted">Memo</span><span>{memo.value}</span></div>}
            <div className="between"><span className="muted">Network fee</span><span>~0.00001 XLM</span></div>
          </div>
        )}
        <Notice kind="error">{a.error}</Notice>
        <Notice kind="ok">{a.ok}</Notice>
        {!review ? (
          <button className="btn btn-primary btn-block" disabled={a.busy || !to || !amount || !ctx.state?.exists || missingTrust} onClick={() => a.run(async () => {
            const r = await resolveRecipient(to);
            setResolved(r);
            if (r.memo) setMemo({ type: r.memoType ?? "text", value: r.memo });
            setReview(true);
          })}>{a.busy ? "Looking up…" : "Review"}</button>
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
  const [name, setName] = useState<string | null>(null);
  useEffect(() => { if (namesEnabled()) myName(ctx.signer.publicKey).then(setName); }, [ctx.signer.publicKey]);
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
        {name && <Field label="Your name"><b style={{ color: "var(--text)", fontSize: "1.1rem" }}>{name}</b></Field>}
        <Field label="Your address"><code className="mono small">{ctx.signer.publicKey}</code></Field>
        <div className="row">
          <Copy text={ctx.signer.publicKey} label="Copy address" />
          {name && <Copy text={name} label="Copy name" />}
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
    if (isFederationAddress(text)) return ctx.go("Send", { destination: text.trim() });
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
          <div className="row"><input className="input" value={paste} onChange={(e) => setPaste(e.target.value)} placeholder="G…, name*domain or web+stellar:pay?…" /><button className="btn btn-ghost btn-sm" disabled={!paste} onClick={() => handle(paste)}>Continue</button></div>
        </Field>
        <Notice kind="error">{err}</Notice>
      </Card>
    </div>
  );
}

// ---------------- Assets / trustlines ----------------

const KNOWN_TESTNET_ASSETS = [
  { label: "USDC", id: "USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5" },
  { label: "SRT (test anchor)", id: "SRT:GCDNJUBQSX7AJWLJACMJ7I4BC3Z47BQUTMHEICZLE6MU4KQBRYG5JY6B" },
];
const KNOWN_MAINNET_ASSETS = [
  { label: "USDC", id: "USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN" },
  { label: "EURC", id: "EURC:GDHU6WRG4IEQXM5NZ4BMPKOXHW76MZM4Y2IEMFDVXBSDP6SJY4ITNPP2" },
];

export function Assets({ ctx }: { ctx: WalletCtx }) {
  const [id, setId] = useState("");
  const a = useAction();
  const credit = (ctx.state?.balances ?? []).filter((b) => !b.isNative);
  const known = NETWORK.name === "testnet" ? KNOWN_TESTNET_ASSETS : KNOWN_MAINNET_ASSETS;
  const busyText = ctx.signer.kind === "external" ? "Confirm in your wallet…" : "Submitting…";

  const add = (assetId: string) =>
    a.run(async () => { const r = await changeTrust(ctx.signer, assetId.trim()); setId(""); await ctx.refresh(); return r; }, (r) => <>Asset added. {txLink(r.hash)}</>);
  const remove = (assetId: string, balance: string) =>
    a.run(async () => {
      if (parseFloat(balance) > 0) throw new Error("Send or convert the full balance before removing this asset");
      if (!confirm("Remove this asset? Its 0.5 XLM reserve will be released.")) throw new Error("Cancelled");
      const r = await changeTrust(ctx.signer, assetId, true); await ctx.refresh(); return r;
    }, (r) => <>Asset removed. {txLink(r.hash)}</>);

  return (
    <div className="center-wrap stack">
      <Card title="Your assets">
        {credit.length === 0 ? <p className="empty">Only XLM so far. Add USDC or another asset below.</p> : (
          <ul className="list">
            {credit.map((b) => (
              <li key={b.id}>
                <span className="coin">{b.code.slice(0, 4)}</span>
                <div className="grow"><b>{b.code}</b><div className="muted small mono">{short(b.issuer, 6)}</div></div>
                <span className="amount">{fmt(b.balance, 4)}</span>
                <button className="btn btn-ghost btn-sm btn-danger" disabled={a.busy} onClick={() => remove(b.id, b.balance)}>Remove</button>
              </li>
            ))}
          </ul>
        )}
        <p className="muted small">Each asset reserves 0.5 XLM, returned when you remove it.</p>
      </Card>
      <Card title="Add an asset">
        <div className="row">
          {known.filter((k) => !credit.some((c) => c.id === k.id)).map((k) => (
            <button key={k.id} className="btn btn-ghost btn-sm" disabled={a.busy || !ctx.state?.exists} onClick={() => add(k.id)}><Icon name="plus" size={14} /> {k.label}</button>
          ))}
        </div>
        <Field label="Custom asset (CODE:ISSUER)"><input placeholder="CODE:G…" value={id} onChange={(e) => setId(e.target.value)} /></Field>
        <Notice kind="error">{a.error}</Notice>
        <Notice kind="ok">{a.ok}</Notice>
        <button className="btn btn-primary btn-block" disabled={a.busy || !id || !ctx.state?.exists} onClick={() => add(id)}>{a.busy ? busyText : "Add asset"}</button>
      </Card>
    </div>
  );
}

// ---------------- Convert (DEX path payments) ----------------

export function Convert({ ctx }: { ctx: WalletCtx }) {
  const balances = ctx.state?.balances ?? [];
  const [from, setFrom] = useState("XLM");
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [slippage, setSlippage] = useState(1);
  const [quote, setQuote] = useState<SwapQuote | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [quoteErr, setQuoteErr] = useState("");
  const a = useAction();
  const toOptions = useMemo(() => balances.filter((b) => b.id !== from), [balances, from]);

  useEffect(() => {
    if ((!to || to === from) && toOptions.length) setTo(toOptions[0].id);
  }, [toOptions, to, from]);

  useEffect(() => {
    setQuote(null); setQuoteErr("");
    if (!amount || !to || !/^\d+(\.\d{1,7})?$/.test(amount) || parseFloat(amount) <= 0) return;
    let cancelled = false;
    setQuoting(true);
    const t = setTimeout(async () => {
      try {
        const q = await quoteSwap(from, to, amount);
        if (cancelled) return;
        if (!q) setQuoteErr("No route found — not enough liquidity for this pair right now");
        setQuote(q);
      } catch (e) {
        if (!cancelled) setQuoteErr(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setQuoting(false);
      }
    }, 400);
    return () => { cancelled = true; clearTimeout(t); };
  }, [from, to, amount]);

  const go = () =>
    a.run(async () => {
      if (!quote) throw new Error("No quote");
      const r = await swap(ctx.signer, from, to, amount, quote, slippage);
      setAmount("");
      await ctx.refresh();
      return r;
    }, (r) => <>Converted. {txLink(r.hash)}</>);

  const label = (id: string) => balances.find((b) => b.id === id)?.code ?? assetLabel(id);
  const flip = () => { if (to) { setFrom(to); setTo(from); } };

  return (
    <div className="center-wrap stack">
      <Card title="Convert">
        {balances.length < 2 ? (
          <>
            <p className="muted">Add the asset you want to convert into (for example USDC) first.</p>
            <button className="btn btn-primary" onClick={() => ctx.go("Assets")}>Add an asset</button>
          </>
        ) : (
          <>
            <Field label="From">
              <select value={from} onChange={(e) => setFrom(e.target.value)}>
                {balances.map((b) => <option key={b.id} value={b.id}>{b.code} — balance {fmt(b.balance, 4)}</option>)}
              </select>
            </Field>
            <div style={{ textAlign: "center" }}><button className="icon-btn" style={{ margin: "0 auto" }} onClick={flip} aria-label="Flip"><Icon name="swap" size={16} /></button></div>
            <Field label="To">
              <select value={to} onChange={(e) => setTo(e.target.value)}>
                {toOptions.map((b) => <option key={b.id} value={b.id}>{b.code}{b.issuer ? ` (${short(b.issuer, 4)})` : ""}</option>)}
              </select>
            </Field>
            <div className="grid2">
              <Field label={`Amount of ${label(from)}`}><input inputMode="decimal" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value.trim())} /></Field>
              <Field label="Max slippage %"><input type="number" min={0.1} max={50} step={0.1} value={slippage} onChange={(e) => setSlippage(parseFloat(e.target.value) || 1)} /></Field>
            </div>
            <div className="quote">
              {quoting ? <span className="muted">Finding the best rate…</span> : quote ? (
                <>
                  <div className="between"><span className="muted">You receive</span><b>≈ {fmt(quote.destAmount, 4)} {label(to)}</b></div>
                  <div className="between small"><span className="muted">Rate</span><span>1 {label(from)} = {fmt(parseFloat(quote.destAmount) / parseFloat(amount), 6)} {label(to)}</span></div>
                  <div className="between small"><span className="muted">Minimum received</span><span>{fmt(parseFloat(quote.destAmount) * (1 - slippage / 100), 4)} {label(to)}</span></div>
                  <div className="between small"><span className="muted">Route</span><span>{quote.path.length ? [label(from), ...quote.path.map((p) => (p.isNative() ? "XLM" : p.getCode())), label(to)].join(" → ") : "Direct"}</span></div>
                </>
              ) : <span className="muted">{quoteErr || "Enter an amount to see a quote"}</span>}
            </div>
            <Notice kind="error">{a.error}</Notice>
            <Notice kind="ok">{a.ok}</Notice>
            <button className="btn btn-primary btn-block" disabled={a.busy || !quote} onClick={go}>{a.busy ? (ctx.signer.kind === "external" ? "Confirm in your wallet…" : "Converting…") : "Convert"}</button>
          </>
        )}
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
