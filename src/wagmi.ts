import { getDefaultConfig } from "@rainbow-me/rainbowkit";
import { http } from "wagmi";
import {
  base,
  baseSepolia,
  mainnet,
  optimism,
  optimismSepolia,
  polygon,
  polygonAmoy
} from "wagmi/chains";

const walletConnectProjectId =
  import.meta.env.VITE_WALLETCONNECT_PROJECT_ID ||
  "00000000000000000000000000000000";

  import { defineChain } from "viem";

export const domaTestnet = defineChain({
  id: 97476,
  name: "Doma Testnet",
  network: "doma-testnet",
  nativeCurrency: {
    name: "DOMA",
    symbol: "DOMA",
    decimals: 18,
  },
  rpcUrls: {
    default: {
      http: ["https://doma-testnet.drpc.org"],
    },
  },
  blockExplorers: {
    default: {
      name: "Doma Explorer",
      url: "https://explorer.testnet.doma.xyz",
    },
  },
});


const chains = [
  mainnet,
  base,
  optimism,
  polygon,
  domaTestnet,
  baseSepolia,
  optimismSepolia,
  polygonAmoy,
] as const;

export const wagmiConfig = getDefaultConfig({
  appName: "Doma Resolver Tester",
  projectId: walletConnectProjectId,
  chains,
  transports: chains.reduce<Record<number, ReturnType<typeof http>>>(
    (acc, chain) => {
      acc[chain.id] = http();
      return acc;
    },
    {}
  ),
});
