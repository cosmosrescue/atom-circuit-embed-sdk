/**
 * Full Next.js App Router page: appearance and features.
 *
 * Only referralId is required (see minimal.jsx for the simplest embed). This
 * file customizes how the widget looks and which features it exposes:
 *   - appearance (theme, chrome, maxWidth)
 *   - validator choice (allowReferralChoice)
 *   - lifecycle callbacks
 *
 * The end user connects their wallet inside the widget, so no wallet
 * configuration is needed here. To reuse a wallet already connected on your
 * page, see parent-wallet.jsx. The dynamic import with ssr:false keeps the
 * iframe-only code out of the server bundle.
 */

'use client';

import dynamic from 'next/dynamic';

const AtomCircuitSwap = dynamic(
  () => import('@atom-circuit/embed-sdk/react').then((m) => m.AtomCircuitSwap),
  {
    ssr: false,
    // Reserve the widget's space while the client chunk loads so the page does
    // not shift when the iframe mounts. Match this to the minHeight prop below.
    loading: () => <div style={{ minHeight: 520 }} />,
  }
);

// Your validator referral id - swap fees stake to this validator. Replace
// 'general' with your own id; 'general' is the shared pool (fees fan across all
// participating validators) so this example runs without configuration.
const REFERRAL_ID = 'general';

/* ----------------------------------------------------------------------- */
/* Appearance                                                               */
/* Theme tokens and chrome toggles. Omit theme or chrome entirely to use    */
/* the widget's own defaults.                                               */
/* ----------------------------------------------------------------------- */

const THEME = {
  mode: 'light',
  accentColor: '#7b61ff',
  accentForeground: '#ffffff',
  background: '#ffffff',
  foreground: '#11131a',
  card: '#f5f6fa',
  // Secondary surface tier: the validator/picker band and the secondary panel.
  cardSecondary: '#eceef5',
  // Input surface only; overrides the card bundle for text/amount inputs.
  input: '#ffffff',
  mutedForeground: '#5b6172',
  border: '#d8dbe5',
  // Focused-input and emphasized-divider border color.
  borderFocus: '#7b61ff',
  warning: '#b8860b',
  success: '#2e9e5b',
  error: '#d64545',
  radius: 12,
  fontSize: 14,
  // The widget loads no fonts itself; use one already present on the host page.
  fontFamily: 'Inter, system-ui, sans-serif',
};

// Each surface is shown by default; set a flag to false to hide it.
const CHROME = {
  logo: true,
  wallet: true,
  validator: true,
  footer: true,
};

export default function Page() {
  return (
    <AtomCircuitSwap
      // Required.
      referralId={REFERRAL_ID}

      // Appearance.
      theme={THEME}
      chrome={CHROME}
      maxWidth="480px"
      minHeight="520px"

      // Validator choice. Let the end user pick the staking validator, with
      // referralId pre-selected as the default.
      allowReferralChoice

      // Lifecycle callbacks.
      onReady={({ protocolVersion }) => {
        console.log('atom-circuit ready', { protocolVersion });
      }}
      onSwapSubmitted={({ txHash, route }) => {
        console.log('atom-circuit swap submitted', { txHash, route });
      }}
      onSwapSuccess={({ txHash }) => {
        console.log('atom-circuit swap success', { txHash });
      }}
      onSwapError={({ code, message }) => {
        console.log('atom-circuit swap error', { code, message });
      }}
      // SDK-level problems (handshake, load, origin, protocol), distinct from
      // the in-widget swap failures reported by onSwapError.
      onError={({ code, message, cause }) => {
        console.log('atom-circuit sdk error', { code, message, cause });
      }}
    />
  );
}
