// Minimal Next.js App Router page. Dynamic import with ssr:false keeps the
// iframe-only code out of the server bundle.

'use client';

import dynamic from 'next/dynamic';

const AtomCircuitSwap = dynamic(
  () => import('@atom-circuit/embed-sdk/react').then((m) => m.AtomCircuitSwap),
  { ssr: false }
);

export default function Page() {
  return <AtomCircuitSwap referralId="YOUR_REFERRAL_ID" />;
}
