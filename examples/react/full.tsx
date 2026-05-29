// Full React embed. Sets every documented prop on AtomCircuitSwap and
// wires every callback so a validator can see the payload shape per event.

import { AtomCircuitSwap } from '@atom-circuit/embed-sdk/react';

export default function SwapPanel() {
  return (
    <AtomCircuitSwap
      referralId="YOUR_REFERRAL_ID" // your validator affiliate id; swap fees route to this validator (required)
      width="100%" // outer width of the widget; any CSS length such as '100%', '420px', '30em'
      maxWidth="480px" // optional cap so the widget does not grow past this when width is fluid
      padding="16px" // empty space the SDK adds around the iframe via a wrapper div; any CSS length
      minHeight="520px" // starting height before the iframe reports its real content height; CSS length
      theme={{
        mode: 'dark', // color palette for the whole widget; 'light', 'dark', or 'auto' (auto follows the host's system setting)
        accentColor: '#7b61ff', // color of primary buttons (Swap, Connect Wallet) and active form highlights; hex like #7b61ff
        background: '#0d0f14', // the widget's outer card background color; hex only
        foreground: '#f5f6fa', // primary text color inside the widget; hex only
        border: '#1f2330', // border color of inputs, the card, and dividers between sections; hex only
        radius: 12, // how rounded the corners of the card, inputs, and buttons are; 0=sharp, 12=mild, 32=very round (px, 0-64)
        fontSize: 14, // base font size in px; everything inside the widget scales relative to this (8-32)
        fontFamily: 'Inter, system-ui, sans-serif', // CSS font-family for widget text; the widget does not load fonts itself, so use one already on the host page (max 200 chars)
      }}
      chrome={{
        logo: true, // show or hide the Atom Circuit logo in the top-left of the widget
        wallet: true, // show or hide the Connect Wallet button in the top-right
        validator: true, // show or hide the "Fees stake with <moniker>" row above the swap form
        footer: true, // show or hide the bottom footer with help and terms links
      }}
      onReady={({ protocolVersion }) => {
        // fires once when the iframe has loaded and the SDK handshake completed; from here the widget is interactive
        console.log('atom-circuit ready', { protocolVersion });
      }}
      onSwapSubmitted={({ txHash, route }) => {
        // fires after the user signs and the source-chain transaction broadcasts; payload has txHash and the optional route summary
        console.log('atom-circuit swap submitted', { txHash, route });
      }}
      onSwapSuccess={({ txHash }) => {
        // fires once the cross-chain delivery is confirmed by the indexer; payload has the source-chain txHash
        console.log('atom-circuit swap success', { txHash });
      }}
      onSwapError={({ code, message }) => {
        // fires when the swap fails inside the iframe or the wallet rejects the signature; payload has a stable code and a human-readable message
        console.log('atom-circuit swap error', { code, message });
      }}
      onResize={({ height }) => {
        // fires when the iframe content height changes; use it to reflow your surrounding page layout if needed (height in px)
        console.log('atom-circuit resize', { height });
      }}
      onError={({ code, message, cause }) => {
        // fires on widget-level problems such as handshake failure, iframe load error, origin mismatch, or protocol incompatibility; separate from onSwapError which covers swap-flow failures
        console.log('atom-circuit sdk error', { code, message, cause });
      }}
    />
  );
}
