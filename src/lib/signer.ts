import { Keypair, TransactionBuilder } from "@stellar/stellar-sdk";
import { NETWORK } from "./config";

/** Anything that can sign Stellar transactions: the built-in wallet or an external wallet (Freighter, xBull…). */
export interface Signer {
  publicKey: string;
  kind: "local" | "external";
  walletName: string;
  walletId?: string;
  /** Signs a transaction envelope (base64 XDR) and returns the signed XDR. */
  sign(xdr: string): Promise<string>;
}

export function localSigner(secret: string): Signer {
  const kp = Keypair.fromSecret(secret);
  return {
    publicKey: kp.publicKey(),
    kind: "local",
    walletName: "Built-in wallet",
    async sign(xdr) {
      const tx = TransactionBuilder.fromXDR(xdr, NETWORK.passphrase);
      tx.sign(kp);
      return tx.toXDR();
    },
  };
}
