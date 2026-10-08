import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { BRAND, NETWORK } from "./lib/config";
import { clearKeystore, decryptSecret, loadKeystore } from "./lib/keystore";
import { loadAccountState, loadHistory, server, type AccountState, type HistoryItem } from "./lib/stellar";
import { localSigner, type Signer } from "./lib/signer";
import { forgetWallet, rememberWallet, restoreWallet } from "./lib/wallets";
import { clearSession, isExtension, isPopup, loadSession, openFullTab, saveSession } from "./lib/platform";
import type { PayRequest } from "./lib/sep7";
import { Landing } from "./components/Landing";
import { ConnectModal } from "./components/ConnectModal";
import { Tour } from "./components/Tour";
import { Icon, Logo } from "./components/Icon";
import { Activity, Assets, Convert, Home, Receive, Scan, Send, type Tab, type WalletCtx } from "./components/Screens";
import { Card, Copy, Field, Notice, short, useAction } from "./components/ui";
import "./App.css";

const EscrowScreen = lazy(() => import("./components/EscrowScreen").then((m) => ({ default: m.EscrowScreen })));
const AnchorScreen = lazy(() => import("./components/AnchorScreen").then((m) => ({ default: m.AnchorScreen })));

if (isPopup) document.documentElement.classList.add("popup");

const AUTO_LOCK_MS = 15 * 60 * 1000;
const NAV: { tab: Tab; icon: string; label: string; mobile?: boolean }[] = [
  { tab: "Home", icon: "home", label: "Home", mobile: true },
  { tab: "Send", icon: "send", label: "Send", mobile: true },
  { tab: "Receive", icon: "receive", label: "Receive", mobile: true },
  { tab: "Scan", icon: "scan", label: "Scan to pay", mobile: true },
  { tab: "Convert", icon: "swap", label: "Convert", mobile: true },
  { tab: "Cash", icon: "bank", label: "Cash in / out" },
  { tab: "Escrow", icon: "shield", label: "Safe pay" },
  { tab: "Assets", icon: "assets", label: "Assets" },
  { tab: "Activity", icon: "activity", label: "Activity" },
  { tab: "Settings", icon: "settings", label: "Settings" },
];

function useTheme() {
  const [theme, setTheme] = useState<"dark" | "light">(() => {
    try { return (localStorage.getItem("theme") as "dark" | "light") || "dark"; } catch { return "dark"; }
  });
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem("theme", theme); } catch { /* ignore */ }
  }, [theme]);
  return [theme, setTheme] as const;
}

export default function App() {
  const [theme, setTheme] = useTheme();
  const [signer, setSigner] = useState<Signer | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [checking, setChecking] = useState(true);
  const [connectOpen, setConnectOpen] = useState(false);
  const [tour, setTour] = useState(false);

  // Restore an unlocked extension session or a previously connected external wallet
  useEffect(() => {
    (async () => {
      const s = await loadSession().catch(() => null);
      if (s) { setSecret(s); setSigner(localSigner(s)); }
      else if (!isExtension) { const ext = restoreWallet(); if (ext) setSigner(ext); }
      if (location.hash === "#/app" && !s) setConnectOpen(true);
      setChecking(false);
    })();
  }, []);

  const onConnected = useCallback((s: Signer, sec?: string) => {
    setSigner(s);
    setSecret(sec ?? null);
    setConnectOpen(false);
    if (sec) saveSession(sec, AUTO_LOCK_MS).catch(() => {});
    if (s.kind === "external") rememberWallet(s);
    history.replaceState(null, "", "#/app");
    try { if (!localStorage.getItem("tour:done")) setTour(true); } catch { /* ignore */ }
  }, []);

  const disconnect = useCallback(() => {
    if (signer?.kind === "external") forgetWallet();
    clearSession().catch(() => {});
    setSigner(null);
    setSecret(null);
    history.replaceState(null, "", location.pathname + location.search);
  }, [signer]);

  const finishTour = () => { setTour(false); try { localStorage.setItem("tour:done", "1"); } catch { /* ignore */ } };

  if (checking) return null;

  return (
    <>
      {signer ? (
        <WalletApp signer={signer} secret={secret} onDisconnect={disconnect} onRemoveLocal={() => { clearKeystore(); disconnect(); }} theme={theme} setTheme={setTheme} />
      ) : isPopup ? (
        <PopupWelcome onStart={() => setConnectOpen(true)} />
      ) : (
        <Landing onStart={() => setConnectOpen(true)} onDemo={() => document.getElementById("how")?.scrollIntoView({ behavior: "smooth" })} />
      )}
      {connectOpen && <ConnectModal onClose={() => setConnectOpen(false)} onConnected={onConnected} />}
      {tour && <Tour onDone={finishTour} />}
      {!isPopup && (
        <div className="theme-toggle">
          <button className={theme === "light" ? "on" : ""} onClick={() => setTheme("light")} aria-label="Light theme"><Icon name="sun" size={16} /></button>
          <button className={theme === "dark" ? "on" : ""} onClick={() => setTheme("dark")} aria-label="Dark theme"><Icon name="moon" size={16} /></button>
        </div>
      )}
    </>
  );
}

function PopupWelcome({ onStart }: { onStart: () => void }) {
  const ks = loadKeystore();
  return (
    <div className="main" style={{ textAlign: "center", paddingTop: 60 }}>
      <div style={{ display: "flex", justifyContent: "center" }}><Logo size={56} /></div>
      <h1 style={{ margin: "18px 0 8px", fontSize: "1.6rem" }}>{BRAND}</h1>
      <p className="muted" style={{ marginBottom: 28 }}>Payments on Stellar, in seconds.</p>
      <button className="btn btn-primary btn-block" onClick={onStart}>{ks ? "Unlock wallet" : "Get started"}</button>
    </div>
  );
}

function WalletApp({ signer, secret, onDisconnect, onRemoveLocal, theme, setTheme }: {
  signer: Signer; secret: string | null; onDisconnect: () => void; onRemoveLocal: () => void; theme: string; setTheme: (t: "dark" | "light") => void;
}) {
  const [tab, setTab] = useState<Tab>(() => {
    const t = new URLSearchParams(location.search).get("tab");
    return NAV.some((n) => n.tab === t) ? (t as Tab) : "Home";
  });
  const [prefill, setPrefill] = useState<PayRequest | undefined>();
  const [state, setState] = useState<AccountState | null>(null);
  const [hist, setHist] = useState<HistoryItem[]>([]);
  const [histLoading, setHistLoading] = useState(false);
  const [netError, setNetError] = useState("");
  const [toast, setToast] = useState("");
  const pk = signer.publicKey;

  const refresh = useCallback(async () => {
    try {
      setState(await loadAccountState(pk));
      setNetError("");
    } catch (e) {
      setNetError(`Can't reach the Stellar network: ${e instanceof Error ? e.message : e}`);
    }
    setHistLoading(true);
    loadHistory(pk).then(setHist).catch(() => {}).finally(() => setHistLoading(false));
  }, [pk]);

  // Live updates: Horizon stream + slow poll fallback; toast on incoming payments
  useEffect(() => {
    setState(null); setHist([]);
    refresh();
    let close: (() => void) | undefined;
    try {
      close = server.payments().forAccount(pk).cursor("now").stream({
        onmessage: (r) => {
          const p = r as unknown as { to?: string; account?: string; amount?: string; starting_balance?: string; asset_code?: string; asset_type?: string };
          if ((p.to === pk || p.account === pk) && (p.amount || p.starting_balance)) {
            setToast(`Received ${p.amount ?? p.starting_balance} ${p.asset_type === "native" || !p.asset_code ? "XLM" : p.asset_code}`);
            setTimeout(() => setToast(""), 5000);
          }
          refresh();
        },
        onerror: () => {},
      });
    } catch { /* streaming unavailable */ }
    const poll = setInterval(refresh, 30_000);
    return () => { close?.(); clearInterval(poll); };
  }, [pk, refresh]);

  // Auto-lock built-in wallet after inactivity
  const lockRef = useRef(onDisconnect);
  lockRef.current = onDisconnect;
  useEffect(() => {
    if (signer.kind !== "local") return;
    let t = setTimeout(() => lockRef.current(), AUTO_LOCK_MS);
    let last = 0;
    const reset = () => {
      clearTimeout(t);
      t = setTimeout(() => lockRef.current(), AUTO_LOCK_MS);
      if (secret && Date.now() - last > 30_000) { last = Date.now(); saveSession(secret, AUTO_LOCK_MS).catch(() => {}); }
    };
    const evs = ["mousemove", "keydown", "click", "touchstart"];
    evs.forEach((e) => window.addEventListener(e, reset));
    return () => { clearTimeout(t); evs.forEach((e) => window.removeEventListener(e, reset)); };
  }, [signer.kind, secret]);

  const go = useCallback((t: Tab, p?: PayRequest) => { setPrefill(p); setTab(t); window.scrollTo(0, 0); }, []);
  const ctx: WalletCtx = { signer, state, history: hist, historyLoading: histLoading, refresh, go, prefill };
  const current = NAV.find((n) => n.tab === tab)!;

  return (
    <div className="shell">
      <aside className="side">
        <div className="brand"><Logo /> {BRAND}</div>
        {NAV.map((n) => (
          <button key={n.tab} className={`side-btn ${tab === n.tab ? "on" : ""}`} onClick={() => go(n.tab)}><Icon name={n.icon} size={18} /> {n.label}</button>
        ))}
        <div className="side-foot">
          <span className={`pill ${NETWORK.name === "testnet" ? "warn" : ""}`} style={{ alignSelf: "flex-start" }}>{NETWORK.name}</span>
          <button className="side-btn" onClick={onDisconnect}><Icon name={signer.kind === "local" ? "lock" : "logout"} size={18} /> {signer.kind === "local" ? "Lock" : "Disconnect"}</button>
        </div>
      </aside>
      <main className="main">
        <div className="topbar">
          <h1>{tab === "Home" ? "Overview" : current.label}</h1>
          <div className="row">
            <div className="acct-chip">
              <span className="dot" />
              <span className="mono">{short(pk, 4)}</span>
              <Copy text={pk} label="" />
            </div>
            {isPopup && <button className="icon-btn" title="Open in a tab" onClick={() => openFullTab(tab)}><Icon name="expand" size={16} /></button>}
            {isPopup && <button className="icon-btn" title="Lock" onClick={onDisconnect}><Icon name="lock" size={16} /></button>}
          </div>
        </div>
        <Notice kind="error">{netError}</Notice>
        <div style={{ marginTop: netError ? 12 : 0 }}>
          {tab === "Home" && <Home ctx={ctx} />}
          {tab === "Send" && <Send key={JSON.stringify(prefill ?? {})} ctx={ctx} />}
          {tab === "Receive" && <Receive ctx={ctx} />}
          {tab === "Scan" && <Scan ctx={ctx} />}
          {tab === "Convert" && <Convert ctx={ctx} />}
          {tab === "Cash" && <Suspense fallback={<p className="muted">Loading…</p>}><AnchorScreen ctx={ctx} /></Suspense>}
          {tab === "Escrow" && <Suspense fallback={<p className="muted">Loading…</p>}><EscrowScreen ctx={ctx} /></Suspense>}
          {tab === "Assets" && <Assets ctx={ctx} />}
          {tab === "Activity" && <Activity ctx={ctx} />}
          {tab === "Settings" && <Settings signer={signer} onDisconnect={onDisconnect} onRemoveLocal={onRemoveLocal} theme={theme} setTheme={setTheme} />}
        </div>
      </main>
      <nav className="bottom-nav">
        {NAV.filter((n) => n.mobile).concat(NAV.find((n) => n.tab === "Settings")!).map((n) => (
          <button key={n.tab} className={tab === n.tab ? "on" : ""} onClick={() => go(n.tab)}><Icon name={n.icon} size={20} />{n.tab === "Scan" ? "Scan" : n.label}</button>
        ))}
      </nav>
      {toast && <div className="toast"><b>{toast}</b></div>}
    </div>
  );
}

function Settings({ signer, onDisconnect, onRemoveLocal, theme, setTheme }: { signer: Signer; onDisconnect: () => void; onRemoveLocal: () => void; theme: string; setTheme: (t: "dark" | "light") => void }) {
  const [pw, setPw] = useState("");
  const [revealed, setRevealed] = useState("");
  const a = useAction();
  const ks = loadKeystore();
  return (
    <div className="center-wrap stack">
      <Card title="Account">
        <Field label="Connected with"><b style={{ color: "var(--text)" }}>{signer.walletName}</b></Field>
        <Field label="Address"><code className="mono small">{signer.publicKey}</code></Field>
        <div className="row">
          <Copy text={signer.publicKey} label="Copy address" />
          <a className="btn btn-ghost btn-sm" href={`${NETWORK.explorer}/account/${signer.publicKey}`} target="_blank" rel="noreferrer">View on explorer ↗</a>
        </div>
        <button className="btn btn-ghost" onClick={onDisconnect}>{signer.kind === "local" ? "Lock wallet" : "Disconnect wallet"}</button>
      </Card>
      <Card title="Appearance">
        <div className="seg">
          <button className={theme === "dark" ? "on" : ""} onClick={() => setTheme("dark")}>Dark</button>
          <button className={theme === "light" ? "on" : ""} onClick={() => setTheme("light")}>Light</button>
        </div>
      </Card>
      {signer.kind === "local" && ks && (
        <>
          <Card title="Back up secret key">
            <p className="muted small">Anyone with your secret key controls your money. Never share it.</p>
            {revealed ? (
              <div className="row"><code className="mono small secret">{revealed}</code><Copy text={revealed} /><button className="btn btn-ghost btn-sm" onClick={() => setRevealed("")}>Hide</button></div>
            ) : (
              <>
                <Field label="Password"><input type="password" value={pw} onChange={(e) => setPw(e.target.value)} /></Field>
                <Notice kind="error">{a.error}</Notice>
                <button className="btn btn-primary" disabled={a.busy || !pw} onClick={() => a.run(async () => { setRevealed(await decryptSecret(ks, pw)); setPw(""); })}>Reveal secret key</button>
              </>
            )}
          </Card>
          <Card title="Remove from this device">
            <p className="muted small">Deletes the encrypted key from this browser. Your money stays on the network; restore any time with your secret key.</p>
            <button className="btn btn-ghost btn-danger" onClick={() => confirm("Remove wallet from this device? Make sure you've backed up your secret key.") && onRemoveLocal()}>Remove wallet</button>
          </Card>
        </>
      )}
    </div>
  );
}
