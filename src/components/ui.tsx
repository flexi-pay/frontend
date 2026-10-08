import { useState, type ReactNode } from "react";
import { Icon } from "./Icon";

export function Card({ title, children, actions }: { title?: ReactNode; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="card">
      {(title || actions) && (
        <div className="card-head">
          {title && <h2>{title}</h2>}
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small className="muted">{hint}</small>}
    </label>
  );
}

export function Notice({ kind, children }: { kind: "error" | "ok" | "info"; children: ReactNode }) {
  if (!children) return null;
  return <div className={`notice ${kind}`} role={kind === "error" ? "alert" : "status"}>{children}</div>;
}

export function Modal({ title, onClose, children, back }: { title: ReactNode; onClose: () => void; children: ReactNode; back?: () => void }) {
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal>
        <div className="modal-head">
          {back ? <button className="icon-btn" onClick={back} aria-label="Back">←</button> : <span style={{ width: 36 }} />}
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close"><Icon name="x" size={16} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function short(addr?: string, n = 6) {
  if (!addr) return "";
  return addr.length > n * 2 + 3 ? `${addr.slice(0, n)}…${addr.slice(-n)}` : addr;
}

export const fmt = (n: string | number, max = 7) =>
  Number(n).toLocaleString(undefined, { maximumFractionDigits: max });

export function Copy({ text, label = "Copy" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="btn btn-ghost btn-sm"
      onClick={async () => {
        try { await navigator.clipboard.writeText(text); } catch { /* clipboard blocked */ }
        setDone(true);
        setTimeout(() => setDone(false), 1200);
      }}
    >
      <Icon name={done ? "check" : "copy"} size={14} /> {done ? "Copied" : label}
    </button>
  );
}

/** Runs an async action and tracks busy / error / success state. */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [ok, setOk] = useState<ReactNode>("");
  async function run<T>(fn: () => Promise<T>, success?: (r: T) => ReactNode) {
    setBusy(true);
    setError("");
    setOk("");
    try {
      const r = await fn();
      if (success) setOk(success(r));
      return r;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg !== "Cancelled") setError(msg);
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, ok, run, setError, setOk };
}
