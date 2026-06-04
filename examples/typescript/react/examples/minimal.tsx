/**
 * Minimal embed. The user connects their wallet inside the widget, so this is
 * the complete setup. referralId is the only required option.
 *
 * No wallet config or theme is needed. Every other option on
 * AtomCircuitSwap is optional; see full.tsx for the appearance and features
 * surface, and parent-wallet.tsx for reusing your page's wallet.
 */

import { AtomCircuitSwap } from '@atom-circuit/embed-sdk/react';

// Your validator referral id - swap fees stake to this validator. Replace
// 'general' with your own id; 'general' is the shared pool (fees fan across all
// participating validators) so this example runs without configuration.
const REFERRAL_ID = 'general';

export default function SwapPanel() {
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
