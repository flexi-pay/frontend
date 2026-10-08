import { BRAND, NETWORK } from "../lib/config";
import { Icon, Logo } from "./Icon";

const TICKER = [
  ["XLM", "Stellar Lumens"], ["USDC", "USD Coin"], ["EURC", "Euro Coin"], ["QR", "Scan to pay"],
  ["DEX", "Built-in exchange"], ["5s", "Settlement"], ["SEP", "Bank on/off-ramps"], ["RS", "Soroban smart contracts"], ["$", "Fees under a cent"],
];

const FEATURES = [
  { icon: "qr", title: "Scan to pay, scan to get paid", body: "Show a code with the amount already in it, or point your camera at someone else's. Codes use the SEP-7 standard, so LOBSTR, xBull and other Stellar wallets can read them too." },
  { icon: "bank", title: "Cash in and cash out", body: "Move between your bank and Stellar through regulated anchors (SEP-24). The anchor's fee is shown before you start, and the final rate before you confirm." },
  { icon: "bolt", title: "Settles in seconds", body: "Payments finalize in about 5 seconds for a fraction of a cent. Send XLM, USDC or any Stellar asset to anyone, anywhere." },
  { icon: "swap", title: "Convert in app", body: "Swap one asset for another on Stellar's built-in exchange, with the best route found for you and a quote you can read before you confirm." },
  { icon: "wallet", title: "Any Stellar wallet", body: "Freighter, xBull, Albedo, LOBSTR, Hana and more are detected automatically. No wallet yet? Create one here in seconds." },
  { icon: "shield", title: "Safe pay with smart contracts", body: "Buying from someone you don't know? Lock the money in a Soroban smart contract, written in Rust. The seller gets paid when you confirm delivery, or you get it back after the deadline." },
];

const STEPS = [
  { t: "Connect wallet", d: "Link the Stellar wallet you already use, or create one in seconds." },
  { t: "Add money", d: "Deposit from your bank through an anchor, or receive from anyone." },
  { t: "Pay or get paid", d: "Send to any address, or scan a code to pay." },
  { t: "Cash out", d: "Withdraw to your bank account through an anchor." },
];

const FAQ = [
  { q: "Is it free?", a: "The app is free. Stellar network fees are a tiny fraction of a cent per transaction. Anchors charge their own deposit/withdrawal fee, which is shown before you start." },
  { q: "Do you hold my money?", a: "No. The app is non-custodial: funds live in your Stellar account, and only your wallet can sign transactions. Built-in wallets are encrypted with your password on your own device." },
  { q: "How does Safe pay work?", a: "Your payment is held by an open-source Soroban smart contract on Stellar — not by us. Only you can release it to the seller; the seller can refund you at any time; and if the seller never delivers you can reclaim it yourself after the deadline." },
  { q: "Which wallets work?", a: "Any wallet supported by Stellar Wallets Kit — Freighter, xBull, Albedo, LOBSTR, Hana, Rabet and more — plus a built-in wallet you can create here." },
  { q: "Why does a new account need XLM?", a: "Stellar accounts must hold a small reserve (1 XLM, plus 0.5 XLM per asset you add). On testnet you can get free test XLM with one click." },
  { q: "Is this real money?", a: NETWORK.name === "testnet" ? "This deployment runs on the Stellar testnet, so all balances are test funds with no real value. It's safe to try everything." : "Yes, this deployment uses Stellar mainnet. Double-check addresses before sending." },
];

export function Landing({ onStart, onDemo }: { onStart: () => void; onDemo: () => void }) {
  return (
    <div className="landing">
      <header className="nav">
        <div className="nav-inner">
          <div className="brand"><Logo /> {BRAND}</div>
          <nav className="nav-links">
            <a href="#features">Features</a>
            <a href="#how">How it works</a>
            <a href="#faq">FAQ</a>
          </nav>
          <button className="btn btn-primary" onClick={onStart}>Get started</button>
        </div>
      </header>

      <section className="section hero">
        <div className="grid-bg" />
        <div style={{ position: "relative" }}>
          <span className="pill"><span className="dot" /> Payments on Stellar{NETWORK.name === "testnet" ? " · Testnet" : ""}</span>
          <h1>Money that <span className="hl">moves</span><br />as fast as you do.</h1>
          <p className="lead">Send and receive dollars and crypto in seconds, get paid by scanning a code, convert between assets, and cash out to your bank — all on the Stellar network.</p>
          <div className="hero-cta">
            <button className="btn btn-primary" onClick={onStart}>Get started <Icon name="arrow" size={16} /></button>
            <button className="btn btn-ghost" onClick={onDemo}>See how it works</button>
          </div>
          <div className="hero-badges">
            <span><Icon name="wallet" size={16} /> Any Stellar wallet</span>
            <span><Icon name="bolt" size={16} /> 5-second settlement</span>
            <span><Icon name="qr" size={16} /> Scan to pay</span>
          </div>
        </div>
        <div className="mock" aria-hidden>
          <div className="phone">
            <div className="between small"><b>{BRAND}</b><span className="dot" /></div>
            <div className="bal"><small className="muted">Total balance</small><b>$2,458.32</b></div>
            <div className="acts"><div>↑ Send</div><div>↓ Receive</div><div>⇄ Convert</div><div>▣ Scan</div></div>
            <div className="small muted">Recent</div>
            <div className="between small"><span>From GDX4…K2PA</span><span style={{ color: "var(--ok)" }}>+120 USDC</span></div>
            <div className="between small"><span>Converted XLM → USDC</span><span>45.10</span></div>
          </div>
          <div className="float f1"><small className="muted">Cashed out</small><b>$480.00</b><small style={{ color: "var(--ok)" }}>✓ Sent to your bank</small></div>
          <div className="float f2">
            <small className="muted">Scan to pay</small>
            <div className="qr-mini">{"11011010101101100101110101011".split("").slice(0, 25).map((c, i) => <i key={i} className={c === "0" ? "o" : ""} />)}</div>
          </div>
          <div className="float f3"><b style={{ fontSize: ".95rem" }}>⚡ 250 USDC sent</b><small className="muted">Settled in 4.8s</small></div>
        </div>
      </section>

      <div className="ticker" aria-hidden>
        <div className="ticker-track">
          {[...TICKER, ...TICKER].map(([c, n], i) => (
            <div className="ticker-item" key={i}><span className="coin">{c}</span>{n}</div>
          ))}
        </div>
      </div>

      <section className="section" id="features">
        <div className="section-title">
          <h2>Everything you need, nothing you don't</h2>
          <p>Six features, built properly, instead of twenty that half work.</p>
        </div>
        <div className="features">
          {FEATURES.map((f) => (
            <div className="feature" key={f.title}>
              <div className="ico"><Icon name={f.icon} /></div>
              <h3>{f.title}</h3>
              <p>{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="section" id="how">
        <div className="section-title">
          <h2>One app. Four steps.</h2>
          <p>From your bank account to anyone in the world, and back again.</p>
        </div>
        <div className="steps">
          {STEPS.map((s, i) => (
            <div className="step" key={s.t}><div className="n">{i + 1}</div><h3>{s.t}</h3><p>{s.d}</p></div>
          ))}
        </div>
      </section>

      <section className="section" id="faq">
        <div className="section-title"><h2>Questions, answered</h2></div>
        <div className="faq">
          {FAQ.map((f) => <details key={f.q}><summary>{f.q}</summary><p>{f.a}</p></details>)}
        </div>
      </section>

      <section className="section">
        <div className="cta">
          <h2>Ready to move your money?</h2>
          <p>Connect a wallet and send your first payment in under a minute. No account to open, nothing to download.</p>
          <button className="btn btn-primary" onClick={onStart}>Get started <Icon name="arrow" size={16} /></button>
        </div>
      </section>

      <footer className="footer">
        <div className="footer-inner">
          <div className="brand"><Logo size={24} /> {BRAND}</div>
          <span>Non-custodial payments on Stellar. Built with stellar-sdk & Stellar Wallets Kit.</span>
          <span>© {new Date().getFullYear()} {BRAND}</span>
        </div>
      </footer>
    </div>
  );
}
