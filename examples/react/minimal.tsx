// Minimal React embed. The only required prop is referralId; the component
// owns the mount container internally.

import { AtomCircuitSwap } from '@atom-circuit/embed-sdk/react';

export default function SwapPanel() {
  return <AtomCircuitSwap referralId="YOUR_REFERRAL_ID" />;
}
