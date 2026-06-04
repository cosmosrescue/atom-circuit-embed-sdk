/**
 * Minimal embed (Next.js App Router). The user connects their wallet inside the
 * widget, so this is the complete setup. referralId is the only required
 * option.
 *
 * No wallet config or theme is needed. The dynamic import with ssr:false
 * keeps the iframe-only code out of the server bundle. See full.jsx for the
 * appearance and features surface, and parent-wallet.jsx for reusing your page's
 * wallet.
 */

'use client';

import dynamic from 'next/dynamic';

const AtomCircuitSwap = dynamic(
  () => import('@atom-circuit/embed-sdk/react').then((m) => m.AtomCircuitSwap),
  {
    ssr: false,
    // Reserve the widget's space while the client chunk loads so the page does
    // not shift when the iframe mounts. Match this to your minHeight.
    loading: () => <div style={{ minHeight: 520 }} />,
  }
);

// Your validator referral id - swap fees stake to this validator. Replace
// 'general' with your own id; 'general' is the shared pool (fees fan across all
// participating validators) so this example runs without configuration.
const REFERRAL_ID = 'general';

export default function Page() {
  return (
    <AtomCircuitSwap
      referralId={REFERRAL_ID}
      minHeight="520px"
      onReady={({ protocolVersion }) => {
        console.log('atom-circuit ready', { protocolVersion });
      }}
      onSwapSuccess={({ txHash }) => {
        console.log('atom-circuit swap success', { txHash });
      }}
    />
  );
}
