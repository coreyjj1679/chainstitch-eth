/**
 * Chain presets offered when creating a project. Native logos are pulled from
 * CoinGecko's asset CDN (small variant — a few hundred bytes each). Testnets
 * reuse their mainnet logo. The trailing "Custom" entry lets a user point at
 * any chain by hand.
 *
 * Ordering: local dev, mainnets, then testnets, then Custom — so the dropdown
 * reads mainnet-first and testnets are flagged with a badge in the UI.
 */
export const CUSTOM_VALUE = "custom";

export type ChainIconKind = "image" | "hammer" | "custom";

export interface ChainPreset {
  /** Select value: the chain id as a string, or CUSTOM_VALUE. */
  value: string;
  label: string;
  /** null for the "Custom" entry. */
  chainId: number | null;
  rpcUrl: string;
  explorerUrl?: string;
  iconKind: ChainIconKind;
  /** CoinGecko asset URL, used when iconKind === "image". */
  iconUrl?: string;
  /** Alt text + fallback monogram for the icon. */
  iconAlt?: string;
  /** True for testnet presets — rendered with a "Testnet" badge. */
  testnet?: boolean;
}

export const CHAIN_PRESETS: ChainPreset[] = [
  {
    value: "31337",
    label: "Anvil / Local",
    chainId: 31337,
    rpcUrl: "http://127.0.0.1:8545",
    iconKind: "hammer",
    iconAlt: "Anvil",
  },
  {
    value: "1",
    label: "Ethereum",
    chainId: 1,
    rpcUrl: "https://eth.llamarpc.com",
    explorerUrl: "https://etherscan.io",
    iconKind: "image",
    iconAlt: "Ethereum",
    iconUrl:
      "https://coin-images.coingecko.com/coins/images/279/small/ethereum.png?1696501628",
  },
  {
    value: "8453",
    label: "Base",
    chainId: 8453,
    rpcUrl: "https://mainnet.base.org",
    explorerUrl: "https://basescan.org",
    iconKind: "image",
    iconAlt: "Base",
    iconUrl:
      "https://coin-images.coingecko.com/coins/images/31199/small/59302ba8-022e-45a4-8d00-e29fe2ee768c-removebg-preview.png?1696530026",
  },
  {
    value: "10",
    label: "Optimism",
    chainId: 10,
    rpcUrl: "https://mainnet.optimism.io",
    explorerUrl: "https://optimistic.etherscan.io",
    iconKind: "image",
    iconAlt: "Optimism",
    iconUrl:
      "https://coin-images.coingecko.com/coins/images/25244/small/Token.png?1774456081",
  },
  {
    value: "42161",
    label: "Arbitrum One",
    chainId: 42161,
    rpcUrl: "https://arb1.arbitrum.io/rpc",
    explorerUrl: "https://arbiscan.io",
    iconKind: "image",
    iconAlt: "Arbitrum",
    iconUrl:
      "https://coin-images.coingecko.com/coins/images/16547/small/arb.jpg?1721358242",
  },
  {
    value: "137",
    label: "Polygon",
    chainId: 137,
    rpcUrl: "https://polygon-rpc.com",
    explorerUrl: "https://polygonscan.com",
    iconKind: "image",
    iconAlt: "Polygon",
    iconUrl:
      "https://coin-images.coingecko.com/coins/images/4713/small/polygon.png?1698233745",
  },
  {
    value: "56",
    label: "BNB Smart Chain",
    chainId: 56,
    rpcUrl: "https://bsc-dataseed.binance.org",
    explorerUrl: "https://bscscan.com",
    iconKind: "image",
    iconAlt: "BNB Smart Chain",
    iconUrl:
      "https://coin-images.coingecko.com/coins/images/825/small/bnb-icon2_2x.png?1696501970",
  },
  {
    value: "43114",
    label: "Avalanche",
    chainId: 43114,
    rpcUrl: "https://api.avax.network/ext/bc/C/rpc",
    explorerUrl: "https://snowtrace.io",
    iconKind: "image",
    iconAlt: "Avalanche",
    iconUrl:
      "https://coin-images.coingecko.com/coins/images/12559/small/Avalanche_Circle_RedWhite_Trans.png?1696512369",
  },
  {
    value: "534352",
    label: "Scroll",
    chainId: 534352,
    rpcUrl: "https://rpc.scroll.io",
    explorerUrl: "https://scrollscan.com",
    iconKind: "image",
    iconAlt: "Scroll",
    iconUrl:
      "https://coin-images.coingecko.com/coins/images/50571/small/scroll.jpg?1728376125",
  },
  {
    value: "59144",
    label: "Linea",
    chainId: 59144,
    rpcUrl: "https://rpc.linea.build",
    explorerUrl: "https://lineascan.build",
    iconKind: "image",
    iconAlt: "Linea",
    iconUrl:
      "https://coin-images.coingecko.com/coins/images/68507/small/linea-logo.jpeg?1756025484",
  },
  {
    value: "1672",
    label: "Pharos Pacific",
    chainId: 1672,
    rpcUrl: "https://rpc.pharos.xyz",
    explorerUrl: "https://www.pharosscan.xyz",
    iconKind: "image",
    iconAlt: "Pharos",
    iconUrl:
      "https://coin-images.coingecko.com/coins/images/102172947/small/pharos_400x400.jpg?1776780623",
  },
  {
    value: "11155111",
    label: "Sepolia",
    chainId: 11155111,
    rpcUrl: "https://sepolia.drpc.org",
    explorerUrl: "https://sepolia.etherscan.io",
    iconKind: "image",
    iconAlt: "Sepolia",
    iconUrl:
      "https://coin-images.coingecko.com/coins/images/279/small/ethereum.png?1696501628",
    testnet: true,
  },
  {
    value: "84532",
    label: "Base Sepolia",
    chainId: 84532,
    rpcUrl: "https://sepolia.base.org",
    explorerUrl: "https://sepolia.basescan.org",
    iconKind: "image",
    iconAlt: "Base Sepolia",
    iconUrl:
      "https://coin-images.coingecko.com/coins/images/31199/small/59302ba8-022e-45a4-8d00-e29fe2ee768c-removebg-preview.png?1696530026",
    testnet: true,
  },
  {
    value: "421614",
    label: "Arbitrum Sepolia",
    chainId: 421614,
    rpcUrl: "https://sepolia-rollup.arbitrum.io/rpc",
    explorerUrl: "https://sepolia-explorer.arbitrum.io",
    iconKind: "image",
    iconAlt: "Arbitrum Sepolia",
    iconUrl:
      "https://coin-images.coingecko.com/coins/images/16547/small/arb.jpg?1721358242",
    testnet: true,
  },
  {
    value: "688689",
    label: "Pharos Atlantic",
    chainId: 688689,
    rpcUrl: "https://atlantic.dplabs-internal.com",
    explorerUrl: "https://atlantic.pharosscan.xyz",
    iconKind: "image",
    iconAlt: "Pharos Atlantic",
    iconUrl:
      "https://coin-images.coingecko.com/coins/images/102172947/small/pharos_400x400.jpg?1776780623",
    testnet: true,
  },
  {
    value: CUSTOM_VALUE,
    label: "Custom",
    chainId: null,
    rpcUrl: "",
    iconKind: "custom",
    iconAlt: "Custom",
  },
];

export const DEFAULT_CHAIN_VALUE = "31337";

export function findChainPreset(value: string | null | undefined): ChainPreset | undefined {
  if (!value) return undefined;
  return CHAIN_PRESETS.find((p) => p.value === value);
}
