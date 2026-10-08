// External Stellar wallets (Freighter, xBull, Albedo, LOBSTR, Hana, Rabet, …) via Stellar Wallets Kit.
import type { Signer } from "./signer";
import { NETWORK } from "./config";

export interface WalletOption {
  id: string;
  name: string;
  icon: string;
  url: string;
  isAvailable: boolean;
}

type Kit = typeof import("@creit.tech/stellar-wallets-kit").StellarWalletsKit;
let kitPromise: Promise<Kit> | null = null;

// Loaded lazily so the landing page stays fast.
function kit(): Promise<Kit> {
  kitPromise ??= (async () => {
    const [{ StellarWalletsKit, Networks }, { defaultModules }] = await Promise.all([
      import("@creit.tech/stellar-wallets-kit"),
      import("@creit.tech/stellar-wallets-kit/modules/utils"),
    ]);
    StellarWalletsKit.init({
      modules: defaultModules(),
      network: NETWORK.name === "mainnet" ? Networks.PUBLIC : Networks.TESTNET,
    });
    return StellarWalletsKit;
  })();
  return kitPromise;
}

export async function listWallets(): Promise<WalletOption[]> {
  const k = await kit();
  const list = await k.refreshSupportedWallets();
  return list
    .map((w) => ({ id: w.id, name: w.name, icon: w.icon, url: w.url, isAvailable: w.isAvailable }))
    .sort((a, b) => Number(b.isAvailable) - Number(a.isAvailable));
}

export async function connectWallet(id: string, name: string): Promise<Signer> {
  const k = await kit();
  k.setWallet(id);
  const { address } = await k.fetchAddress();
  return externalSigner(id, name, address);
}

function externalSigner(id: string, name: string, address: string): Signer {
  return {
    publicKey: address,
    kind: "external",
    walletName: name,
    walletId: id,
    async sign(xdr) {
      const k = await kit();
      k.setWallet(id);
      const { signedTxXdr } = await k.signTransaction(xdr, { networkPassphrase: NETWORK.passphrase, address });
      return signedTxXdr;
    },
  };
}

const LAST = "wallet:last-external";
export function rememberWallet(s: Signer) {
  try { localStorage.setItem(LAST, JSON.stringify({ id: s.walletId, name: s.walletName, address: s.publicKey })); } catch { /* ignore */ }
}
export function forgetWallet() {
  try { localStorage.removeItem(LAST); } catch { /* ignore */ }
  kitPromise?.then((k) => k.disconnect()).catch(() => {});
}
export function restoreWallet(): Signer | null {
  try {
    const v = JSON.parse(localStorage.getItem(LAST) ?? "null");
    return v?.id && v?.address ? externalSigner(v.id, v.name, v.address) : null;
  } catch {
    return null;
  }
}
