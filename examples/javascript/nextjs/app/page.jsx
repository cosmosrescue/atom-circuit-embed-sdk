'use client';

import { Suspense } from 'react';
import dynamic from 'next/dynamic';
import { useSearchParams } from 'next/navigation';

// Each example is loaded with ssr:false. The parent-wallet examples pull in
// wagmi and cosmos-kit, whose providers touch browser-only globals (indexedDB,
// window) at render time; deferring them to the client keeps prerender clean.
const Minimal = dynamic(() => import('../examples/minimal'), { ssr: false });
const Full = dynamic(() => import('../examples/full'), { ssr: false });
const ParentWallet = dynamic(() => import('../examples/parent-wallet'), {
  ssr: false,
});
const ParentWalletCosmosKit = dynamic(
  () => import('../examples/parent-wallet-cosmoskit'),
  { ssr: false }
);

// This harness renders one example at a time, selected by the ?example= query
// param, with a small nav to switch between them. Each example file is a
// standalone App Router page; this file only exists to run them locally.
const EXAMPLES = {
  minimal: { label: 'minimal', Component: Minimal },
  full: { label: 'full', Component: Full },
  'parent-wallet': { label: 'parent-wallet', Component: ParentWallet },
  'parent-wallet-cosmoskit': {
    label: 'parent-wallet-cosmoskit',
    Component: ParentWalletCosmosKit,
  },
};

function Harness() {
  const requested = useSearchParams().get('example');
  const current =
    requested && requested in EXAMPLES ? requested : 'minimal';

  const { Component } = EXAMPLES[current];

  return (
    <>
      <nav
        style={{
          display: 'flex',
          gap: 12,
          marginBottom: 24,
          fontFamily: 'system-ui, sans-serif',
          fontSize: 14,
        }}
      >
        {Object.keys(EXAMPLES).map((key) => (
          <a
            key={key}
            href={`?example=${key}`}
            style={{ fontWeight: key === current ? 700 : 400 }}
          >
            {EXAMPLES[key].label}
          </a>
        ))}
      </nav>
      <Component />
    </>
  );
}

export default function Page() {
  // useSearchParams suspends during prerender; the boundary keeps the build
  // happy and lets the nav hydrate on the client.
  return (
    <Suspense>
      <Harness />
    </Suspense>
  );
}
