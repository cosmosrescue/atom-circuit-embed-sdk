// Install the Buffer global before any example module loads (the
// parent-wallet-cosmoskit example's cosmos-kit dependencies reference it at
// module-eval time). This must be the first import.
import './polyfills';

import React from 'react';
import ReactDOM from 'react-dom/client';

import Minimal from '../examples/minimal';
import Full from '../examples/full';
import ParentWallet from '../examples/parent-wallet';
import ParentWalletCosmosKit from '../examples/parent-wallet-cosmoskit';

// This harness renders one example at a time, selected by the ?example= query
// param, with a small nav to switch between them. Each example file is a
// standalone component you copy into your own app; this file only exists to run
// them locally.
const EXAMPLES = {
  minimal: { label: 'minimal', Component: Minimal },
  full: { label: 'full', Component: Full },
  'parent-wallet': { label: 'parent-wallet', Component: ParentWallet },
  'parent-wallet-cosmoskit': {
    label: 'parent-wallet-cosmoskit',
    Component: ParentWalletCosmosKit,
  },
} as const;

type ExampleKey = keyof typeof EXAMPLES;

const requested = new URLSearchParams(window.location.search).get('example');
const current: ExampleKey =
  requested && requested in EXAMPLES ? (requested as ExampleKey) : 'minimal';

const { Component } = EXAMPLES[current];

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('#root not found');

ReactDOM.createRoot(rootEl).render(
  <React.StrictMode>
    <main style={{ maxWidth: 600, margin: '40px auto', padding: 16 }}>
      <nav
        style={{
          display: 'flex',
          gap: 12,
          marginBottom: 24,
          fontFamily: 'system-ui, sans-serif',
          fontSize: 14,
        }}
      >
        {(Object.keys(EXAMPLES) as ExampleKey[]).map((key) => (
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
    </main>
  </React.StrictMode>,
);
