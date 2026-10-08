import { useState } from "react";
import { BRAND } from "../lib/config";
import { Icon } from "./Icon";

const STEPS = [
  { icon: "bolt", title: `Welcome to ${BRAND}`, body: "Payments, conversions and bank cash-out on Stellar, in one app. Here's a 20-second tour.", items: [["wallet", "Payments"], ["swap", "Convert"], ["bank", "Cash out"]] },
  { icon: "send", title: "Send & receive", body: "Send XLM, USDC or any Stellar asset in about 5 seconds. Share your address or a QR code to get paid.", items: [["send", "Send"], ["receive", "Receive"], ["activity", "History"]] },
  { icon: "qr", title: "Scan to pay", body: "Create a payment code with the amount already in it, or scan someone else's with your camera.", items: [["qr", "Request"], ["scan", "Scan"], ["check", "Done"]] },
  { icon: "bank", title: "Cash in & out", body: "Use an anchor to move between your bank and Stellar. The fee is shown before you begin.", items: [["bank", "Deposit"], ["swap", "Convert"], ["trend", "Withdraw"]] },
];

export function Tour({ onDone }: { onDone: () => void }) {
  const [i, setI] = useState(0);
  const s = STEPS[i];
  const last = i === STEPS.length - 1;
  return (
    <div className="overlay">
      <div className="modal" role="dialog" aria-modal style={{ textAlign: "center" }}>
        <div className="big-ico"><Icon name={s.icon} size={26} /></div>
        <h2 style={{ fontSize: "1.25rem" }}>{s.title}</h2>
        <p className="muted">{s.body}</p>
        <div className="between small"><span>Progress</span><span>{Math.round(((i + 1) / STEPS.length) * 100)}% complete</span></div>
        <div className="progress"><div style={{ width: `${((i + 1) / STEPS.length) * 100}%` }} /></div>
        <div className="tour-dots">{STEPS.map((_, k) => <i key={k} className={k === i ? "on" : ""} />)}</div>
        <div className="tour-icons">{s.items.map(([ic, l]) => <div key={l}><div className="ico"><Icon name={ic} /></div>{l}</div>)}</div>
        <div className="between">
          <button className="btn btn-ghost btn-sm" onClick={onDone}>Skip tour</button>
          <button className="btn btn-primary btn-sm" onClick={() => (last ? onDone() : setI(i + 1))}>{last ? "Let's go" : "Next"} <Icon name="arrow" size={14} /></button>
        </div>
      </div>
    </div>
  );
}
