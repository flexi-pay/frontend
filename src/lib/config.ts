import { Networks } from "@stellar/stellar-sdk";

export type NetworkName = "testnet" | "mainnet";

export interface NetworkConfig {
  name: NetworkName;
  horizonUrl: string;
  passphrase: string;
  friendbotUrl?: string;
  sorobanRpcUrl: string;
  explorer: string;
  defaultAnchor: string;
}

export const NETWORKS: Record<NetworkName, NetworkConfig> = {
  testnet: {
    name: "testnet",
    horizonUrl: "https://horizon-testnet.stellar.org",
    passphrase: Networks.TESTNET,
    friendbotUrl: "https://friendbot.stellar.org",
    sorobanRpcUrl: "https://soroban-testnet.stellar.org",
    explorer: "https://stellar.expert/explorer/testnet",
    defaultAnchor: "testanchor.stellar.org",
  },
  mainnet: {
    name: "mainnet",
    horizonUrl: "https://horizon.stellar.org",
    // No SDF-hosted public mainnet RPC: set VITE_SOROBAN_RPC_URL to a provider (e.g. from developers.stellar.org/docs/data/rpc/rpc-providers)
    sorobanRpcUrl: "",
    passphrase: Networks.PUBLIC,
    explorer: "https://stellar.expert/explorer/public",
    defaultAnchor: "",
  },
};

// Network is chosen at build time. Default is testnet so nothing real is at risk.
const base: NetworkConfig =
  NETWORKS[(import.meta.env?.VITE_STELLAR_NETWORK as NetworkName) || "testnet"] ?? NETWORKS.testnet;
export const NETWORK: NetworkConfig = {
  ...base,
  sorobanRpcUrl: (import.meta.env?.VITE_SOROBAN_RPC_URL as string) || base.sorobanRpcUrl,
};

/** Product name — change it here to rebrand the whole app. */
export const BRAND = "Starling";

/** Deployed Starling escrow contract (C…). Deploy it from flexi-pay/contracts (scripts/deploy.sh) and set VITE_ESCROW_CONTRACT_ID. */
export const ESCROW_CONTRACT_ID: string = (import.meta.env?.VITE_ESCROW_CONTRACT_ID as string) || "";

/** FlexiPay names service (flexi-pay/backend). Leave empty to hide the names feature. */
export const NAMES_API: string = ((import.meta.env?.VITE_NAMES_API as string) || "").replace(/\/$/, "");
/** Domain names live under, e.g. "flexipay.app" → nuel*flexipay.app */
export const NAMES_DOMAIN: string = ((import.meta.env?.VITE_NAMES_DOMAIN as string) || "").toLowerCase();
