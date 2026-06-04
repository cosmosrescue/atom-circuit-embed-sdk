/**
 * IIFE / CDN global-surface tests. The vanilla entry attaches a frozen
 * `AtomCircuit` object to `window` and re-exports the same members as named
 * exports. CDN integrators rely on the wallet helpers being reachable from the
 * global (e.g. `AtomCircuit.fromInjectedCosmosWallet(window.keplr)`), so this
 * pins that surface: mount + buildIframeSrc, the four wallet helpers, and the
 * version/origin/sandbox constants, each present and of the right shape.
 */

import { describe, it, expect, beforeAll } from 'vitest';

import * as vanilla from '../src/vanilla.js';
import {
  fromCosmosKit,
  fromInjectedCosmosWallet,
  fromKeplr,
  fromWagmi,
} from '../src/helpers.js';
import { WALLET_SIGNAL_NS, EVM_BRIDGE_NS } from '../src/protocol.js';

interface GlobalLike {
  mount: unknown;
  buildIframeSrc: unknown;
  fromInjectedCosmosWallet: unknown;
  fromKeplr: unknown;
  fromCosmosKit: unknown;
  fromWagmi: unknown;
  PROTOCOL_VERSION: unknown;
  WIDGET_ORIGIN: unknown;
  SANDBOX_ATTR: unknown;
  WALLET_SIGNAL_NS: unknown;
  EVM_BRIDGE_NS: unknown;
}

const WALLET_HELPERS = [
  'fromInjectedCosmosWallet',
  'fromKeplr',
  'fromCosmosKit',
  'fromWagmi',
] as const;

describe('vanilla IIFE global surface', () => {
  let global: GlobalLike;

  beforeAll(() => {
    // Importing src/vanilla.js attaches the frozen api to window.AtomCircuit.
    global = (window as unknown as { AtomCircuit: GlobalLike }).AtomCircuit;
  });

  it('attaches AtomCircuit to window on import', () => {
    expect(global).toBeDefined();
  });

  it('is frozen so the global cannot be patched as a clickjacking gadget', () => {
    expect(Object.isFrozen(global)).toBe(true);
  });

  it('exposes mount and buildIframeSrc as functions', () => {
    expect(typeof global.mount).toBe('function');
    expect(typeof global.buildIframeSrc).toBe('function');
  });

  it.each(WALLET_HELPERS)('exposes %s on the global as a callable function', (name) => {
    expect(typeof (global as unknown as Record<string, unknown>)[name]).toBe('function');
  });

  it('points the global wallet helpers at the same implementations as the package root', () => {
    expect(global.fromInjectedCosmosWallet).toBe(fromInjectedCosmosWallet);
    expect(global.fromKeplr).toBe(fromKeplr);
    expect(global.fromCosmosKit).toBe(fromCosmosKit);
    expect(global.fromWagmi).toBe(fromWagmi);
  });

  it('exposes the protocol/origin/sandbox constants as non-empty strings', () => {
    expect(typeof global.PROTOCOL_VERSION).toBe('string');
    expect((global.PROTOCOL_VERSION as string).length).toBeGreaterThan(0);
    expect(typeof global.WIDGET_ORIGIN).toBe('string');
    expect((global.WIDGET_ORIGIN as string).length).toBeGreaterThan(0);
    expect(typeof global.SANDBOX_ATTR).toBe('string');
    expect((global.SANDBOX_ATTR as string).length).toBeGreaterThan(0);
  });

  it('exposes the WALLET_SIGNAL_NS / EVM_BRIDGE_NS namespace constants matching the npm exports', () => {
    // IIFE/npm export parity: these are npm-exported constants and must also be
    // reachable from the CDN global so the surface matches.
    expect(global.WALLET_SIGNAL_NS).toBe(WALLET_SIGNAL_NS);
    expect(global.EVM_BRIDGE_NS).toBe(EVM_BRIDGE_NS);
    expect(vanilla.WALLET_SIGNAL_NS).toBe(WALLET_SIGNAL_NS);
    expect(vanilla.EVM_BRIDGE_NS).toBe(EVM_BRIDGE_NS);
  });

  it('re-exports the four wallet helpers as named module exports too', () => {
    expect(vanilla.fromInjectedCosmosWallet).toBe(fromInjectedCosmosWallet);
    expect(vanilla.fromKeplr).toBe(fromKeplr);
    expect(vanilla.fromCosmosKit).toBe(fromCosmosKit);
    expect(vanilla.fromWagmi).toBe(fromWagmi);
  });

  it('the four helpers are actually callable from the global (construct an EVM handle)', () => {
    const provider = { request: async () => undefined };
    const handle = (
      global.fromWagmi as (p: typeof provider) => { provider: unknown }
    )(provider);
    expect(handle.provider).toBe(provider);
  });
});
