import { Keypair, TransactionBuilder } from "@stellar/stellar-sdk";
import { NETWORK } from "./config";

/** Anything that can sign for a Stellar account: the built-in wallet or an external wallet (Freighter, xBull…). */
export interface Signer {
  publicKey: string;
  kind: "local" | "external";
  walletName: string;
  walletId?: string;
  /** Signs a transaction envelope (base64 XDR) and returns the signed XDR. */
  sign(xdr: string): Promise<string>;
  /** Signs an arbitrary text message per SEP-53 and returns a base64 signature. */
  signMessage(message: string): Promise<string>;
}

const SEP53_PREFIX = "Stellar Signed Message:\n";

/** SHA-256("Stellar Signed Message:\n" + message) — the payload SEP-53 wallets sign. */
export async function sep53Hash(message: string): Promise<Uint8Array> {
  const data = new TextEncoder().encode(SEP53_PREFIX + message);
  return new Uint8Array(await crypto.subtle.digest("SHA-256", data));
}

export function localSigner(secret: string): Signer {
  const kp = Keypair.fromSecret(secret);
  return {
    publicKey: kp.publicKey(),
    kind: "local",
    walletName: "Starling wallet",
    async sign(xdr) {
      const tx = TransactionBuilder.fromXDR(xdr, NETWORK.passphrase);
      tx.sign(kp);
      return tx.toXDR();
    },
    async signMessage(message) {
      return Buffer.from(kp.sign(Buffer.from(await sep53Hash(message)))).toString("base64");
    },
  };
}
