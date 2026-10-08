import { useEffect, useState } from "react";
import { Keypair } from "@stellar/stellar-sdk";
import { clearKeystore, decryptSecret, encryptSecret, loadKeystore, saveKeystore } from "../lib/keystore";
import { localSigner, type Signer } from "../lib/signer";
import { connectWallet, listWallets, type WalletOption } from "../lib/wallets";
import { isExtension } from "../lib/platform";
import { Icon } from "./Icon";
import { Copy, Field, Modal, Notice, short, useAction } from "./ui";

type View = "list" | "create" | "import" | "unlock";

export function ConnectModal({ onClose, onConnected }: { onClose: () => void; onConnected: (s: Signer, secret?: string) => void }) {
  const [ks, setKs] = useState(() => loadKeystore());
  const [view, setView] = useState<View>(ks ? "unlock" : "list");
  const [wallets, setWallets] = useState<WalletOption[] | null>(null);
  const [walletErr, setWalletErr] = useState("");
  const a = useAction();

  useEffect(() => {
    if (isExtension) { setWallets([]); return; } // extension pages can't talk to other wallet extensions
    listWallets().then(setWallets).catch((e) => { setWallets([]); setWalletErr(String(e?.message ?? e)); });
  }, []);

  const pickExternal = (w: WalletOption) =>
    a.run(async () => {
      if (!w.isAvailable) { window.open(w.url, "_blank", "noopener"); throw new Error(`${w.name} isn't installed. Install it, then refresh this page.`); }
      try {
        onConnected(await connectWallet(w.id, w.name));
      } catch (e) {
        const m = (e as { message?: string })?.message ?? String(e);
        throw new Error(`${w.name}: ${m}`);
      }
    });

  const title = { list: "Connect wallet", create: "Create a wallet", import: "Import a wallet", unlock: "Welcome back" }[view];

  return (
    <Modal title={title} onClose={onClose} back={view !== "list" ? () => { a.setError(""); setView("list"); } : undefined}>
      {view === "list" && (
        <>
          <div className="group-label">Built-in wallet</div>
          {ks && (
            <button className="wallet-btn" onClick={() => setView("unlock")}>
              <span className="wi"><Icon name="lock" size={18} /></span>
              <span className="grow">Unlock saved wallet<small className="mono">{short(ks.publicKey)}</small></span>
              <span className="pill">Saved</span>
            </button>
          )}
          <button className="wallet-btn" onClick={() => setView("create")}>
            <span className="wi"><Icon name="plus" size={18} /></span>
            <span className="grow">Create a new wallet<small>Takes 10 seconds, stored encrypted on this device</small></span>
            <Icon name="arrow" size={16} />
          </button>
          <button className="wallet-btn" onClick={() => setView("import")}>
            <span className="wi"><Icon name="key" size={18} /></span>
            <span className="grow">Import secret key<small>Use an existing Stellar account</small></span>
            <Icon name="arrow" size={16} />
          </button>

          {!isExtension && (
            <>
              <div className="group-label">Stellar wallets</div>
              {wallets === null && <p className="muted small">Detecting wallets…</p>}
              {wallets?.map((w) => (
                <button key={w.id} className="wallet-btn" disabled={a.busy} onClick={() => pickExternal(w)}>
                  {w.icon ? <img src={w.icon} alt="" /> : <span className="wi"><Icon name="wallet" size={18} /></span>}
                  <span className="grow">{w.name}<small>{w.isAvailable ? "Ready to connect" : "Not installed — click to get it"}</small></span>
                  {w.isAvailable ? <span className="pill">Available</span> : <Icon name="arrow" size={16} />}
                </button>
              ))}
              {walletErr && <p className="muted small">Couldn't load external wallets: {walletErr}</p>}
            </>
          )}
          <Notice kind="error">{a.error}</Notice>
        </>
      )}
      {view === "create" && <CreateWallet onDone={(secret) => { setKs(loadKeystore()); onConnected(localSigner(secret), secret); }} />}
      {view === "import" && <ImportWallet hasExisting={!!ks} onDone={(secret) => { setKs(loadKeystore()); onConnected(localSigner(secret), secret); }} />}
      {view === "unlock" && ks && (
        <UnlockWallet
          publicKey={ks.publicKey}
          onUnlock={(pw) => decryptSecret(ks, pw).then((secret) => onConnected(localSigner(secret), secret))}
          onForget={() => { clearKeystore(); setKs(null); setView("list"); }}
        />
      )}
    </Modal>
  );
}

function PasswordFields({ pw, pw2, setPw, setPw2, onEnter }: { pw: string; pw2: string; setPw: (v: string) => void; setPw2: (v: string) => void; onEnter: () => void }) {
  return (
    <>
      <Field label="Password (encrypts your key on this device)">
        <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" />
      </Field>
      <Field label="Confirm password">
        <input type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} onKeyDown={(e) => e.key === "Enter" && onEnter()} autoComplete="new-password" />
      </Field>
    </>
  );
}

async function storeKey(kp: Keypair, pw: string, pw2: string) {
  if (pw.length < 8) throw new Error("Password must be at least 8 characters");
  if (pw !== pw2) throw new Error("Passwords do not match");
  saveKeystore(await encryptSecret(kp.publicKey(), kp.secret(), pw));
}

function CreateWallet({ onDone }: { onDone: (secret: string) => void }) {
  const [kp] = useState(() => Keypair.random());
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [saved, setSaved] = useState(false);
  const a = useAction();
  const go = () => a.run(async () => {
    if (!saved) throw new Error("Please confirm you've saved your secret key");
    await storeKey(kp, pw, pw2);
    onDone(kp.secret());
  });
  return (
    <>
      <Field label="Your address (share this to get paid)"><code className="mono small">{kp.publicKey()}</code></Field>
      <Field label="Secret key — write it down. It's the only way to recover your money.">
        <div className="row"><code className="mono small secret">{kp.secret()}</code><Copy text={kp.secret()} /></div>
      </Field>
      <label className="check"><input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} /> I've saved my secret key somewhere safe</label>
      <PasswordFields pw={pw} pw2={pw2} setPw={setPw} setPw2={setPw2} onEnter={go} />
      <Notice kind="error">{a.error}</Notice>
      <button className="btn btn-primary btn-block" disabled={a.busy} onClick={go}>{a.busy ? "Encrypting…" : "Create wallet"}</button>
    </>
  );
}

function ImportWallet({ onDone, hasExisting }: { onDone: (secret: string) => void; hasExisting: boolean }) {
  const [secret, setSecret] = useState("");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const a = useAction();
  const go = () => a.run(async () => {
    let kp: Keypair;
    try { kp = Keypair.fromSecret(secret.trim()); } catch { throw new Error("That isn't a valid secret key (it starts with S and has 56 characters)"); }
    if (hasExisting && !confirm("This replaces the wallet saved on this device. Continue?")) throw new Error("Cancelled");
    await storeKey(kp, pw, pw2);
    onDone(kp.secret());
  });
  return (
    <>
      <Field label="Secret key"><input type="password" placeholder="S…" value={secret} onChange={(e) => setSecret(e.target.value)} autoComplete="off" /></Field>
      <PasswordFields pw={pw} pw2={pw2} setPw={setPw} setPw2={setPw2} onEnter={go} />
      <Notice kind="error">{a.error}</Notice>
      <button className="btn btn-primary btn-block" disabled={a.busy} onClick={go}>{a.busy ? "Encrypting…" : "Import wallet"}</button>
    </>
  );
}

function UnlockWallet({ publicKey, onUnlock, onForget }: { publicKey: string; onUnlock: (pw: string) => Promise<void>; onForget: () => void }) {
  const [pw, setPw] = useState("");
  const a = useAction();
  const go = () => a.run(() => onUnlock(pw));
  return (
    <>
      <p className="muted small mono" style={{ textAlign: "center" }}>{publicKey}</p>
      <Field label="Password"><input type="password" autoFocus value={pw} onChange={(e) => setPw(e.target.value)} onKeyDown={(e) => e.key === "Enter" && go()} /></Field>
      <Notice kind="error">{a.error}</Notice>
      <button className="btn btn-primary btn-block" disabled={a.busy || !pw} onClick={go}>{a.busy ? "Unlocking…" : "Unlock"}</button>
      <button className="btn btn-ghost btn-block btn-sm btn-danger" onClick={() => confirm("Remove this wallet from this device? You'll need the secret key to restore it.") && onForget()}>
        Forgot password? Remove from this device
      </button>
    </>
  );
}
