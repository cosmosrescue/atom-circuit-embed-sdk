/**
 * Parent-wallet embed with cosmos-kit and wagmi (React): the widget reuses both
 * the Cosmos wallet (cosmos-kit) and the EVM wallet (wagmi) already connected on
 * your page.
 *
 * Atom Circuit swaps can be sourced from Cosmos chains and from EVM chains
 * (Ethereum, Base, Arbitrum, and others), so a complete parent-wallet
 * integration supplies both channels. cosmos-kit manages only Cosmos wallets, so
 * the EVM wallet comes from a separate stack. This example uses wagmi, the
 * standard React pairing: cosmos-kit for Cosmos, wagmi for EVM.
 *
 * The two channels are independent. Pass only `cosmos` to support Cosmos source
 * chains, only `evm` for EVM source chains, or both for the full set; whichever
 * you omit, the widget offers its own in-widget connect for that channel. For
 * the raw injected-provider variant (no cosmos-kit, no wagmi), see
 * parent-wallet.tsx.
 *
 * Parent-wallet mode needs no configuration: the widget trusts its actual
 * embedding origin, which the browser supplies and a page cannot spoof.
 * A WalletConnect project id is still required for cosmos-kit and wagmi.
 */

import { useEffect, useState } from 'react';
import { AtomCircuitSwap } from '@atom-circuit/embed-sdk/react';
import {
  fromCosmosKit,
  fromWagmi,
  type WalletCosmosHandle,
  type WalletEvmHandle,
} from '@atom-circuit/embed-sdk';

// cosmos-kit's wallet-picker modal is built on @interchain-ui/react. This
// side-effect import loads its default stylesheet so the modal renders styled
// instead of as a raw overlay. Import it once at the app entry. You can theme or
// replace it with your own styles if you want the picker to match your brand.
import '@interchain-ui/react/styles';

// ---------------------------------------------------------------------------
// Your existing cosmos-kit setup (Cosmos channel). If you already use
// cosmos-kit, this is the boilerplate you already have; reuse it as-is. It wraps
// the app in a ChainProvider configured with the Cosmos Hub chain and assets
// from chain-registry, the Keplr and Cosmostation wallets, and your
// WalletConnect project id.
// ---------------------------------------------------------------------------

import { ChainProvider, useChain } from '@cosmos-kit/react';
import { wallets as keplrWallets } from '@cosmos-kit/keplr';
import { wallets as cosmostationWallets } from '@cosmos-kit/cosmostation';
import { chains, assets } from 'chain-registry';

// ---------------------------------------------------------------------------
// Your existing wagmi setup (EVM channel). If you already use wagmi, this is the
// boilerplate you already have; reuse it as-is. wagmi v2+ requires a
// react-query provider alongside WagmiProvider.
// ---------------------------------------------------------------------------

import { WagmiProvider, createConfig, http, useAccount, useConnect } from 'wagmi';
import { mainnet, base, arbitrum, optimism, polygon, avalanche } from 'wagmi/chains';
import { injected, walletConnect } from 'wagmi/connectors';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Replace with your own WalletConnect Cloud project id (shared by cosmos-kit and
// wagmi).
const WALLETCONNECT_PROJECT_ID = 'YOUR_WALLETCONNECT_PROJECT_ID';

// The Cosmos chain the widget connects against. cosmos-kit reads it by
// chain_name; the on-chain id is cosmoshub-4.
const COSMOS_CHAIN_NAME = 'cosmoshub';

const cosmoshubChain = chains.filter((c) => c.chain_name === COSMOS_CHAIN_NAME);
const cosmoshubAssets = assets.filter((a) => a.chain_name === COSMOS_CHAIN_NAME);
const cosmosWallets = [...keplrWallets, ...cosmostationWallets];

// The EVM chains your users swap from. Add or remove to match your app.
const evmChains = [mainnet, base, arbitrum, optimism, polygon, avalanche] as const;

const evmTransports: Record<number, ReturnType<typeof http>> = {};
for (const chain of evmChains) {
  evmTransports[chain.id] = http();
}

const wagmiConfig = createConfig({
  chains: evmChains,
  connectors: [
    // EVM defaults to Keplr, so one wallet serves both Cosmos and EVM. Keplr
    // announces via EIP-6963 (rdns 'app.keplr'), which wagmi discovers
    // automatically; this explicit target is the fallback. Alternatives:
    //   - MetaMask / any injected wallet: use a bare `injected()` (resolves to window.ethereum)
    //   - let the user pick from all installed wallets: rely on wagmi's default
    //     EIP-6963 discovery and render the `useConnect().connectors` list
    injected({
      target: () => ({
        id: 'app.keplr',
        name: 'Keplr',
        provider: typeof window !== 'undefined' ? window.keplr?.ethereum : undefined,
      }),
    }),
    walletConnect({ projectId: WALLETCONNECT_PROJECT_ID }),
  ],
  transports: evmTransports,
});

const queryClient = new QueryClient();

// ---------------------------------------------------------------------------
// Widget configuration.
// ---------------------------------------------------------------------------

// Your validator referral id - swap fees stake to this validator. Replace
// 'general' with your own id; 'general' is the shared pool (fees fan across all
// participating validators) so this example runs without configuration.
const REFERRAL_ID = 'general';

function SwapPanel() {
  // Cosmos channel. cosmos-kit owns connect: useChain exposes the connection
  // state, the connected wallet (its client lives at chainWallet.client), the
  // address, and openView (its wallet picker modal).
  const {
    isWalletConnected,
    chainWallet,
    address: cosmosAddress,
    openView,
  } = useChain(COSMOS_CHAIN_NAME);
  // useChain() has no top-level `client` - the wallet client is chainWallet.client (only after connect).
  const cosmosClient = chainWallet?.client;

  // When cosmos-kit reports a connected client, wrap it with fromCosmosKit and
  // hand it to the widget. The widget adopts it live, so it can render before the
  // user connects and pick up the wallet afterward without remounting.
  const [cosmos, setCosmos] = useState<WalletCosmosHandle | undefined>(undefined);
  useEffect(() => {
    setCosmos(
      isWalletConnected && cosmosClient
        ? fromCosmosKit(cosmosClient as never, { metadata: { name: 'My App' } })
        : undefined,
    );
  }, [isWalletConnected, cosmosClient]);

  // EVM channel. wagmi owns connect: useAccount exposes the connection status and
  // the active connector; useConnect triggers a connection. We read `status`
  // (not just isConnected) so we can tell a fully connected account apart from
  // one that wagmi is still rehydrating.
  const { status: evmStatus, connector, address: evmAddress } = useAccount();
  const isEvmConnected = evmStatus === 'connected';
  const { connect, connectors } = useConnect();
  // Prefer the EIP-6963-discovered Keplr connector, then the explicit target above.
  // To use MetaMask instead, find `c.type === 'injected'`; to offer a chooser, map over `connectors`.
  const evmConnector =
    connectors.find((c) => (c as { rdns?: string }).rdns === 'app.keplr') ??
    connectors.find((c) => c.id === 'app.keplr') ??
    connectors.find((c) => c.name === 'Keplr') ??
    connectors[0];

  // fromWagmi needs the resolved EIP-1193 provider, which wagmi exposes
  // asynchronously via connector.getProvider(). Resolve it only when the EVM
  // account is fully connected and the connector exposes getProvider; on
  // rehydrate wagmi briefly reports a connector that is still reconnecting and
  // not yet ready, so the evm handle stays unset until then.
  const [evm, setEvm] = useState<WalletEvmHandle | undefined>(undefined);
  useEffect(() => {
    let cancelled = false;
    if (isEvmConnected && connector && typeof connector.getProvider === 'function') {
      void connector.getProvider().then((provider) => {
        if (!cancelled) {
          setEvm(fromWagmi(provider as Parameters<typeof fromWagmi>[0]));
        }
      });
    } else {
      setEvm(undefined);
    }
    return () => {
      cancelled = true;
    };
  }, [isEvmConnected, connector]);

  return (
    <div>
      {/* Your existing connect controls. cosmos-kit and wagmi render their own
          wallet pickers; we never touch window.keplr or window.ethereum and never
          handle addresses by hand. */}
      <header
        style={{
          display: 'flex',
          gap: 8,
          alignItems: 'center',
          padding: '12px 0',
          fontFamily: 'system-ui, sans-serif',
          fontSize: 14,
        }}
      >
        <button type="button" onClick={() => openView()}>
          {isWalletConnected && cosmosAddress
            ? `Cosmos: ${cosmosAddress}`
            : 'Connect Cosmos (cosmos-kit)'}
        </button>
        <button
          type="button"
          onClick={() => evmConnector && connect({ connector: evmConnector })}
        >
          {isEvmConnected && evmAddress ? `EVM: ${evmAddress}` : 'Connect EVM (Keplr)'}
        </button>
      </header>

      <AtomCircuitSwap
        // Required.
        referralId={REFERRAL_ID}
        minHeight="520px"

        // Reuse the cosmos-kit and wagmi wallets connected on this page. mode
        // bakes into the iframe URL; the cosmos and evm handles are adopted live
        // the moment they are set.
        wallet={{
          mode: 'parent',
          cosmos,
          evm,
        }}
        // The in-widget Connect control routes here too: cosmos opens the
        // cosmos-kit picker, evm triggers the wagmi connector, the same connect
        // flows the header buttons use.
        onWalletConnectRequest={(channel) => {
          if (channel === 'cosmos') {
            openView();
          } else if (evmConnector) {
            connect({ connector: evmConnector });
          }
        }}

        onReady={({ protocolVersion }) => {
          console.log('atom-circuit ready', { protocolVersion });
        }}
        onSwapSuccess={({ txHash }) => {
          console.log('atom-circuit swap success', { txHash });
        }}
        onError={({ code, message, cause }) => {
          console.log('atom-circuit sdk error', { code, message, cause });
        }}
      />
    </div>
  );
}

export default function ParentWalletCosmosKit() {
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <ChainProvider
          chains={cosmoshubChain}
          assetLists={cosmoshubAssets}
          // chain-registry and cosmos-kit version their shared types
          // independently; the cast mirrors the standard cosmos-kit ChainProvider
          // setup.
          wallets={cosmosWallets as never}
          throwErrors={false}
          walletConnectOptions={{
            signClient: { projectId: WALLETCONNECT_PROJECT_ID },
          }}
        >
          <SwapPanel />
        </ChainProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
