/**
 * Parent-wallet embed (React): the widget reuses the wallet already connected on
 * your page.
 *
 * This example imitates an integrator dapp that already has wallet connection in
 * its own header. The host page connects the wallet, and the widget adopts it,
 * so the end user never connects a second time. Both connect paths work: the
 * host's own Connect buttons, and the Connect control inside the widget (which
 * calls back into the same host connect function).
 *
 * Parent-wallet mode needs no configuration: the widget trusts its actual
 * embedding origin, which the browser supplies and a page cannot spoof.
 */

import { useCallback, useState } from 'react';
import { AtomCircuitSwap } from '@atom-circuit/embed-sdk/react';
import {
  fromInjectedCosmosWallet,
  fromWagmi,
  type WalletChannel,
  type WalletCosmosHandle,
  type WalletEvmHandle,
} from '@atom-circuit/embed-sdk';

// Your validator referral id - swap fees stake to this validator. Replace
// 'general' with your own id; 'general' is the shared pool (fees fan across all
// participating validators) so this example runs without configuration.
const REFERRAL_ID = 'general';

// The Cosmos chain the host connects against to read the address shown in the
// header. The widget handles per-chain signing itself once the handle is set.
const COSMOS_CHAIN_ID = 'cosmoshub-4';

// Read an injected Cosmos provider. Keplr lives at window.keplr; Cosmostation
// exposes the same Keplr API at window.cosmostation.providers.keplr.
function getInjectedCosmosProvider(): Parameters<typeof fromInjectedCosmosWallet>[0] | undefined {
  const w = window as unknown as {
    keplr?: Parameters<typeof fromInjectedCosmosWallet>[0] & {
      enable?: (chainId: string) => Promise<void>;
      getKey?: (chainId: string) => Promise<{ bech32Address: string }>;
    };
    cosmostation?: { providers?: { keplr?: Parameters<typeof fromInjectedCosmosWallet>[0] } };
  };
  return w.keplr ?? w.cosmostation?.providers?.keplr;
}

// Prefer Keplr's EVM provider (window.keplr.ethereum) so one Keplr wallet
// serves both Cosmos and EVM; fall back to window.ethereum (MetaMask / any
// other injected EVM wallet).
function getInjectedEvmProvider(): Parameters<typeof fromWagmi>[0] | undefined {
  const w = window as unknown as {
    keplr?: { ethereum?: Parameters<typeof fromWagmi>[0] };
    ethereum?: Parameters<typeof fromWagmi>[0];
  };
  return w.keplr?.ethereum ?? w.ethereum;
}

export default function SwapPanel() {
  // Wallet handles the widget adopts, plus the addresses the header displays.
  const [cosmos, setCosmos] = useState<WalletCosmosHandle | undefined>(undefined);
  const [evm, setEvm] = useState<WalletEvmHandle | undefined>(undefined);
  const [cosmosAddress, setCosmosAddress] = useState<string | undefined>(undefined);
  const [evmAddress, setEvmAddress] = useState<string | undefined>(undefined);

  // Connect the parent-page wallet for the requested channel, build the handle,
  // and store it so the widget adopts it. The header buttons call this directly,
  // and onWalletConnectRequest below routes the in-widget Connect here too.
  const connectChannel = useCallback(async (channel: WalletChannel) => {
    if (channel === 'cosmos') {
      const provider = getInjectedCosmosProvider() as
        | (Parameters<typeof fromInjectedCosmosWallet>[0] & {
            enable?: (chainId: string) => Promise<void>;
            getKey?: (chainId: string) => Promise<{ bech32Address: string }>;
          })
        | undefined;
      if (!provider) {
        console.warn('No injected Cosmos wallet found (Keplr / Cosmostation).');
        return;
      }
      await provider.enable?.(COSMOS_CHAIN_ID);
      const key = await provider.getKey?.(COSMOS_CHAIN_ID);
      setCosmos(fromInjectedCosmosWallet(provider, { metadata: { name: 'My App' } }));
      setCosmosAddress(key?.bech32Address);
    } else {
      const provider = getInjectedEvmProvider();
      if (!provider) {
        console.warn('No injected EVM wallet found.');
        return;
      }
      const accounts = (await provider.request({
        method: 'eth_requestAccounts',
      })) as string[];
      setEvm(fromWagmi(provider));
      setEvmAddress(accounts?.[0]);
    }
  }, []);

  return (
    <div>
      {/* The integrator's own wallet connection, the same header a real host
          page already renders. Connecting here hands the wallet to the widget. */}
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
        <button type="button" onClick={() => void connectChannel('cosmos')}>
          {cosmosAddress ? `Cosmos: ${cosmosAddress}` : 'Connect Cosmos'}
        </button>
        <button type="button" onClick={() => void connectChannel('evm')}>
          {evmAddress ? `EVM: ${evmAddress}` : 'Connect EVM'}
        </button>
      </header>

      <AtomCircuitSwap
        // Required.
        referralId={REFERRAL_ID}
        minHeight="520px"

        // Reuse the wallet connected on this page. mode bakes into the iframe
        // URL; the cosmos and evm handles are adopted live the moment they are
        // set, so the widget can render before the user connects and pick up the
        // wallet afterward without remounting.
        wallet={{
          mode: 'parent',
          cosmos,
          evm,
        }}
        // The in-widget Connect control routes here too, so clicking Connect
        // inside the widget runs the same host connect flow.
        onWalletConnectRequest={(channel) => {
          void connectChannel(channel);
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
