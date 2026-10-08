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
