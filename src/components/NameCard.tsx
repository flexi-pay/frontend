import { useEffect, useState } from "react";
import { NAMES_DOMAIN } from "../lib/config";
import { checkName, claimName, myName, namesEnabled, releaseName, type NameInfo } from "../lib/names";
import type { Signer } from "../lib/signer";
import { Card, Copy, Notice, useAction } from "./ui";

/** Claim a FlexiPay name (nuel*flexipay.app) for this account. */
export function NameCard({ signer }: { signer: Signer }) {
  const [current, setCurrent] = useState<string | null | undefined>(undefined);
  const [input, setInput] = useState("");
  const [info, setInfo] = useState<NameInfo | null>(null);
  const a = useAction();

  useEffect(() => { myName(signer.publicKey).then(setCurrent); }, [signer.publicKey]);

  // Debounced availability check
  useEffect(() => {
    setInfo(null);
    const n = input.trim().toLowerCase();
    if (n.length < 3) return;
    const t = setTimeout(() => checkName(n).then(setInfo).catch(() => setInfo(null)), 350);
    return () => clearTimeout(t);
  }, [input]);

  if (!namesEnabled()) return null;
  const busyText = signer.kind === "external" ? "Approve in your wallet…" : "Saving…";

  return (
    <Card title="Your FlexiPay name">
      <p className="muted small">Get paid with a name instead of a long address. Any Stellar wallet can send to it. Claiming is free: you just sign a message to prove the account is yours.</p>
      {current === undefined ? <p className="muted">Loading…</p> : current ? (
        <div className="between">
          <b style={{ fontSize: "1.15rem" }}>{current}</b>
          <div className="row">
            <Copy text={current} label="Copy" />
            <button className="btn btn-ghost btn-sm btn-danger" disabled={a.busy} onClick={() => a.run(async () => {
              if (!confirm(`Release ${current}? Someone else could claim it.`)) throw new Error("Cancelled");
              await releaseName(signer, current.split("*")[0]);
              setCurrent(null);
            }, () => "Name released")}>Release</button>
          </div>
        </div>
      ) : null}
      <div className="row">
        <input className="input" placeholder={current ? "Change to a new name" : "yourname"} value={input} onChange={(e) => setInput(e.target.value.toLowerCase().replace(/\s/g, ""))} />
        <span className="muted">*{NAMES_DOMAIN}</span>
      </div>
      {info && <small style={{ color: info.available ? "var(--ok)" : "var(--err)" }}>{info.available ? `✓ ${info.stellarAddress} is available` : info.reason}</small>}
      <Notice kind="error">{a.error}</Notice>
      <Notice kind="ok">{a.ok}</Notice>
      <button className="btn btn-primary" disabled={a.busy || !info?.available} onClick={() => a.run(async () => {
        const n = await claimName(signer, input);
        setCurrent(n); setInput("");
        return n;
      }, (n) => `You're now ${n}`)}>{a.busy ? busyText : current ? "Switch to this name" : "Claim name"}</button>
    </Card>
  );
}
