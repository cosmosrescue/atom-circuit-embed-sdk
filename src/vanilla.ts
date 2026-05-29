/**
 * IIFE entry. Bundled with `--format iife --global-name AtomCircuit` by tsup
 * so static-site validators can drop a single `<script>` tag and call
 * `AtomCircuit.mount(container, { referralId })`.
 *
 * The global is shaped as a frozen object to discourage runtime patching
 * (which would otherwise be a clickjacking gadget).
 */

import { mount, buildIframeSrc, SANDBOX_ATTR } from './mount.js';
import { PROTOCOL_VERSION, WIDGET_ORIGIN } from './protocol.js';

export interface AtomCircuitGlobal {
  readonly mount: typeof mount;
  readonly buildIframeSrc: typeof buildIframeSrc;
  readonly PROTOCOL_VERSION: string;
  readonly WIDGET_ORIGIN: string;
  readonly SANDBOX_ATTR: string;
}

const api: AtomCircuitGlobal = Object.freeze({
  mount,
  buildIframeSrc,
  PROTOCOL_VERSION,
  WIDGET_ORIGIN,
  SANDBOX_ATTR,
});

if (typeof window !== 'undefined') {
  // Attach without overriding a pre-existing global; if AtomCircuit is
  // already defined the host is in charge.
  const w = window as unknown as { AtomCircuit?: AtomCircuitGlobal };
  if (!w.AtomCircuit) {
    w.AtomCircuit = api;
  }
}

// Re-exported as named exports only. tsup's IIFE wrapper assigns the
// namespace object to `window.AtomCircuit` via the `--global-name` option,
// which means consumers get `window.AtomCircuit.mount(...)` directly.
// Avoid `export default` here so the IIFE namespace surface stays clean
// (no `AtomCircuit.default` shim).
export { mount, buildIframeSrc, PROTOCOL_VERSION, WIDGET_ORIGIN, SANDBOX_ATTR };
