/**
 * mount()-level parent-wallet tests.
 *
 * Two halves:
 * 1. URL contract (buildIframeSrc): walletMode + parentOrigin params appear ONLY
 *    in mode 'parent'; mode 'iframe'/absent is byte-identical to the pre-feature
 *    output (backward-compat invariant #1). Parent mode trusts the embedding
 *    page by its own origin: parentOrigin is stamped unconditionally and is the
 *    single param that establishes trust.
 * 2. Bridge wiring through mount(): the bridge is wired for cosmos-only,
 *    evm-only, and both, and torn down on destroy(). Cosmiframe is mocked so
 *    these tests pin OUR wiring, not cosmiframe internals.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { EVM_BRIDGE_NS, WALLET_SIGNAL_NS } from '../src/protocol.js';
import type { Eip1193ProviderLike } from '../src/protocol.js';

const listenSpy = vi.fn<(opts: unknown) => () => void>();
vi.mock('@dao-dao/cosmiframe', () => ({
  Cosmiframe: {
    listen: (opts: unknown): (() => void) => listenSpy(opts),
  },
}));

import { mount, buildIframeSrc } from '../src/mount.js';
import { IframeClient } from '../src/iframe-client.js';

const WIDGET = 'https://atomcircuit.net';

function cosmosHandle() {
  return {
    target: {},
    getOfflineSignerDirect: vi.fn(),
    getOfflineSignerAmino: vi.fn(),
  };
}

describe('buildIframeSrc() - wallet URL contract', () => {
  it('does NOT add walletMode/parentOrigin when wallet is absent (byte-identical to pre-feature)', () => {
    const before = buildIframeSrc({ referralId: 'val1' });
    const after = buildIframeSrc({ referralId: 'val1', wallet: undefined });
    expect(after).toBe(before);
    expect(new URL(after).searchParams.has('walletMode')).toBe(false);
    expect(new URL(after).searchParams.has('parentOrigin')).toBe(false);
  });

  it("does NOT add walletMode/parentOrigin when wallet.mode === 'iframe' (byte-identical)", () => {
    const before = buildIframeSrc({ referralId: 'val1' });
    const after = buildIframeSrc({
      referralId: 'val1',
      wallet: { mode: 'iframe' },
    });
    expect(after).toBe(before);
  });

  it("adds walletMode=parent and the embedding-page parentOrigin in mode 'parent'", () => {
    const url = buildIframeSrc({
      referralId: 'val1',
      wallet: { mode: 'parent' },
    });
    const parsed = new URL(url);
    expect(parsed.searchParams.get('walletMode')).toBe('parent');
    // jsdom runs at http://localhost:3000 - that is the embedder origin the SDK
    // stamps as the single trust param in parent mode.
    expect(parsed.searchParams.get('parentOrigin')).toBe('http://localhost:3000');
    // parentOrigin is the only trust param; no `token` is part of the contract.
    expect(parsed.searchParams.has('token')).toBe(false);
    // Existing params still present.
    expect(parsed.searchParams.get('ref')).toBe('val1');
    expect(parsed.searchParams.get('v')).toBeTruthy();
  });

  it("parent URL is byte-identical to the pinned output (pinned string)", () => {
    const url = buildIframeSrc({
      referralId: 'val1',
      wallet: { mode: 'parent' },
    });
    expect(url).toBe(
      `${WIDGET}/embed/swap?ref=val1&v=${
        new URL(buildIframeSrc({ referralId: 'val1' })).searchParams.get('v')
      }&walletMode=parent&parentOrigin=${encodeURIComponent('http://localhost:3000')}`
    );
  });

  it('rides walletMode/parentOrigin alongside theme + allowReferralChoice', () => {
    const url = buildIframeSrc({
      referralId: 'val1',
      allowReferralChoice: true,
      theme: { mode: 'dark' },
      wallet: { mode: 'parent' },
    });
    const parsed = new URL(url);
    expect(parsed.searchParams.get('walletMode')).toBe('parent');
    expect(parsed.searchParams.get('parentOrigin')).toBe('http://localhost:3000');
    expect(parsed.searchParams.has('token')).toBe(false);
    expect(parsed.searchParams.has('theme')).toBe(true);
  });
});

describe("buildIframeSrc() - parent mode (stamps parentOrigin)", () => {
  it("stamps walletMode and parentOrigin as the only added params in parent mode", () => {
    const url = buildIframeSrc({
      referralId: 'val1',
      wallet: { mode: 'parent' },
    });
    const parsed = new URL(url);
    expect(parsed.searchParams.get('walletMode')).toBe('parent');
    expect(parsed.searchParams.has('token')).toBe(false);
    expect(parsed.searchParams.get('parentOrigin')).toBe('http://localhost:3000');
  });

  it("does NOT stamp parentOrigin in mode 'iframe' or when wallet is absent", () => {
    const a = new URL(buildIframeSrc({ referralId: 'val1', wallet: { mode: 'iframe' } }));
    const b = new URL(buildIframeSrc({ referralId: 'val1' }));
    expect(a.searchParams.has('parentOrigin')).toBe(false);
    expect(b.searchParams.has('parentOrigin')).toBe(false);
  });

  it('does NOT stamp parentOrigin when location.origin is the literal "null" (opaque origin)', () => {
    const orig = Object.getOwnPropertyDescriptor(globalThis, 'location');
    Object.defineProperty(globalThis, 'location', {
      configurable: true,
      get: () => ({ origin: 'null' }),
    });
    try {
      const parsed = new URL(
        buildIframeSrc({ referralId: 'val1', wallet: { mode: 'parent' } })
      );
      expect(parsed.searchParams.get('walletMode')).toBe('parent');
      expect(parsed.searchParams.has('parentOrigin')).toBe(false);
    } finally {
      if (orig) Object.defineProperty(globalThis, 'location', orig);
    }
  });

  it('does NOT throw and stamps nothing when there is no location (SSR)', () => {
    const orig = Object.getOwnPropertyDescriptor(globalThis, 'location');
    Object.defineProperty(globalThis, 'location', {
      configurable: true,
      get: () => undefined,
    });
    try {
      let parsed: URL | undefined;
      expect(() => {
        parsed = new URL(
          buildIframeSrc({ referralId: 'val1', wallet: { mode: 'parent' } })
        );
      }).not.toThrow();
      expect(parsed?.searchParams.get('walletMode')).toBe('parent');
      expect(parsed?.searchParams.has('parentOrigin')).toBe(false);
      expect(parsed?.searchParams.has('token')).toBe(false);
    } finally {
      if (orig) Object.defineProperty(globalThis, 'location', orig);
    }
  });

  it('mount() in parent mode still creates the bridge controller (setWallet non-inert)', () => {
    // Block the handshake so the mount stays alive.
    vi.spyOn(IframeClient.prototype, 'init').mockImplementation(
      () =>
        new Promise(() => {
          /* never resolves */
        })
    );
    listenSpy.mockReset();
    listenSpy.mockReturnValue(() => {
      /* unlisten */
    });
    const container = document.createElement('div');
    document.body.appendChild(container);
    const handle = mount(container, { wallet: { mode: 'parent' } });
    // The mounted src carries walletMode + parentOrigin, and never a token.
    const src = new URL(handle.iframe.src);
    expect(src.searchParams.get('walletMode')).toBe('parent');
    expect(src.searchParams.get('parentOrigin')).toBe('http://localhost:3000');
    expect(src.searchParams.has('token')).toBe(false);
    // A late setWallet wires the bridge (controller exists, not inert).
    handle.setWallet({
      cosmos: {
        target: {},
        getOfflineSignerDirect: vi.fn(),
        getOfflineSignerAmino: vi.fn(),
      },
    });
    expect(listenSpy).toHaveBeenCalledTimes(1);
    handle.destroy();
    container.remove();
    vi.restoreAllMocks();
  });
});

describe('mount() - wallet bridge wiring', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    listenSpy.mockReset();
    listenSpy.mockReturnValue(() => {
      /* unlisten */
    });
    // Block the handshake so the iframe stays mounted for assertion.
    vi.spyOn(IframeClient.prototype, 'init').mockImplementation(
      () => new Promise(() => {
        /* never resolves */
      })
    );
  });

  afterEach(() => {
    container.remove();
    vi.restoreAllMocks();
  });

  it('does NOT wire any bridge in mode iframe / absent', () => {
    const addSpy = vi.spyOn(window, 'addEventListener');
    const h1 = mount(container, { referralId: 'val1' });
    const h2 = mount(container, {
      referralId: 'val1',
      wallet: { mode: 'iframe' },
    });
    expect(listenSpy).not.toHaveBeenCalled();
    expect(addSpy.mock.calls.some((c) => c[0] === 'message')).toBe(false);
    addSpy.mockRestore();
    h1.destroy();
    h2.destroy();
  });

  it('installs the cosmiframe listener at mount in mode parent even with no handle (answers the embed handshake)', () => {
    const handle = mount(container, {
      referralId: 'val1',
      wallet: { mode: 'parent' },
    });
    // Parent mode creates the bridge controller at mount, which installs the
    // cosmiframe listener immediately so the parent answers the embed's
    // isCosmiframe / getMetadata handshake before any wallet connects.
    expect(listenSpy).toHaveBeenCalledTimes(1);
    const arg = listenSpy.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(arg['iframe']).toBe(handle.iframe);
    expect(arg['origins']).toEqual([WIDGET]);
    handle.destroy();
  });

  it('wires the Cosmos bridge (cosmos-only) and pins origins to the widget origin', () => {
    const handle = mount(container, {
      referralId: 'val1',
      wallet: { mode: 'parent', cosmos: cosmosHandle() },
    });
    expect(listenSpy).toHaveBeenCalledTimes(1);
    const arg = listenSpy.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(arg['iframe']).toBe(handle.iframe);
    expect(arg['origins']).toEqual([WIDGET]);
    handle.destroy();
  });

  it('resolves the widget origin from a custom opts.origin for the bridge', () => {
    const handle = mount(container, {
      referralId: 'val1',
      origin: 'https://staging.example.com',
      wallet: { mode: 'parent', cosmos: cosmosHandle() },
    });
    const arg = listenSpy.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(arg['origins']).toEqual(['https://staging.example.com']);
    handle.destroy();
  });

  it('wires the EVM bridge (evm-only) and relays a request', async () => {
    const request = vi.fn().mockResolvedValue('0x1');
    const provider: Eip1193ProviderLike = {
      request,
      on: vi.fn(),
      removeListener: vi.fn(),
    };
    const handle = mount(container, {
      referralId: 'val1',
      wallet: { mode: 'parent', evm: { provider } },
    });
    // The cosmiframe listener is installed at mount for any parent-mode embed
    // (it answers the handshake regardless of which channel(s) get a handle);
    // the EVM relay is wired in addition by setWallet({ evm }).
    expect(listenSpy).toHaveBeenCalledTimes(1);

    const win = { postMessage: vi.fn() };
    Object.defineProperty(handle.iframe, 'contentWindow', {
      configurable: true,
      get: () => win as unknown as Window,
    });
    const event = new MessageEvent('message', {
      data: { ns: EVM_BRIDGE_NS, kind: 'request', id: 'q', method: 'eth_chainId' },
      origin: WIDGET,
    });
    Object.defineProperty(event, 'source', {
      configurable: true,
      get: () => handle.iframe.contentWindow,
    });
    window.dispatchEvent(event);
    for (let i = 0; i < 8; i += 1) await Promise.resolve();

    expect(request).toHaveBeenCalledWith({ method: 'eth_chainId' });
    handle.destroy();
  });

  it('wires BOTH channels when both handles supplied', () => {
    const provider: Eip1193ProviderLike = {
      request: vi.fn(),
      on: vi.fn(),
      removeListener: vi.fn(),
    };
    const handle = mount(container, {
      referralId: 'val1',
      wallet: {
        mode: 'parent',
        cosmos: cosmosHandle(),
        evm: { provider },
      },
    });
    expect(listenSpy).toHaveBeenCalledTimes(1);
    handle.destroy();
  });

  it('tears the bridge down on destroy() (cosmiframe unlisten + provider removeListener)', () => {
    const unlisten = vi.fn();
    listenSpy.mockReturnValue(unlisten);
    const removeListener = vi.fn();
    const provider: Eip1193ProviderLike = {
      request: vi.fn(),
      on: vi.fn(),
      removeListener,
    };
    const handle = mount(container, {
      referralId: 'val1',
      wallet: {
        mode: 'parent',
        cosmos: cosmosHandle(),
        evm: { provider },
      },
    });
    handle.destroy();
    expect(unlisten).toHaveBeenCalledTimes(1);
    expect(removeListener).toHaveBeenCalledTimes(3);
  });

  it('puts walletMode/parentOrigin in the mounted iframe src in mode parent', () => {
    const handle = mount(container, {
      referralId: 'val1',
      wallet: { mode: 'parent', cosmos: cosmosHandle() },
    });
    const src = new URL(handle.iframe.src);
    expect(src.searchParams.get('walletMode')).toBe('parent');
    expect(src.searchParams.get('parentOrigin')).toBe('http://localhost:3000');
    expect(src.searchParams.has('token')).toBe(false);
    handle.destroy();
  });
});

describe('mount() - late setWallet / clearWallet (spec A.5, option Y)', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    listenSpy.mockReset();
    listenSpy.mockReturnValue(() => {
      /* unlisten */
    });
    vi.spyOn(IframeClient.prototype, 'init').mockImplementation(
      () => new Promise(() => {
        /* never resolves */
      })
    );
  });

  afterEach(() => {
    container.remove();
    vi.restoreAllMocks();
  });

  function fakeContentWindow(iframe: HTMLIFrameElement): { postMessage: ReturnType<typeof vi.fn> } {
    const win = { postMessage: vi.fn() };
    Object.defineProperty(iframe, 'contentWindow', {
      configurable: true,
      get: () => win as unknown as Window,
    });
    return win;
  }

  function signalsTo(win: { postMessage: ReturnType<typeof vi.fn> }): Array<Record<string, unknown>> {
    return win.postMessage.mock.calls
      .map((c) => c[0] as Record<string, unknown>)
      .filter((m) => m && m['ns'] === WALLET_SIGNAL_NS);
  }

  it('mode parent + NO handles still builds walletMode=parent&parentOrigin URL and does not crash', () => {
    const handle = mount(container, {
      referralId: 'val1',
      wallet: { mode: 'parent' },
    });
    const src = new URL(handle.iframe.src);
    expect(src.searchParams.get('walletMode')).toBe('parent');
    expect(src.searchParams.get('parentOrigin')).toBe('http://localhost:3000');
    expect(src.searchParams.has('token')).toBe(false);
    // The cosmiframe listener is installed at mount (parent mode) so the embed
    // handshake is answered immediately; no logical channel is adopted yet.
    expect(listenSpy).toHaveBeenCalledTimes(1);
    // setWallet is a live method, not undefined.
    expect(typeof handle.setWallet).toBe('function');
    expect(typeof handle.clearWallet).toBe('function');
    handle.destroy();
  });

  it('late setWallet wires the bridge and posts ready (no remount)', () => {
    const handle = mount(container, {
      referralId: 'val1',
      wallet: { mode: 'parent' },
    });
    const win = fakeContentWindow(handle.iframe);
    const before = handle.iframe;

    handle.setWallet({
      cosmos: {
        target: {},
        getOfflineSignerDirect: vi.fn(),
        getOfflineSignerAmino: vi.fn(),
      },
    });
    // Same iframe element: no remount.
    expect(handle.iframe).toBe(before);
    expect(listenSpy).toHaveBeenCalledTimes(1);
    const signals = signalsTo(win);
    expect(signals).toHaveLength(1);
    expect(signals[0]).toEqual({
      ns: WALLET_SIGNAL_NS,
      kind: 'ready',
      channels: ['cosmos'],
    });
    handle.destroy();
  });

  it('clearWallet tears the channel down and posts gone', () => {
    const provider: Eip1193ProviderLike = {
      request: vi.fn(),
      on: vi.fn(),
      removeListener: vi.fn(),
    };
    const handle = mount(container, {
      referralId: 'val1',
      wallet: { mode: 'parent', evm: { provider } },
    });
    const win = fakeContentWindow(handle.iframe);

    handle.clearWallet(['evm']);
    const signals = signalsTo(win);
    expect(signals).toContainEqual({
      ns: WALLET_SIGNAL_NS,
      kind: 'gone',
      channels: ['evm'],
    });
    handle.destroy();
  });

  it('setWallet / clearWallet are no-ops in mode iframe (no bridge controller)', () => {
    const handle = mount(container, {
      referralId: 'val1',
      wallet: { mode: 'iframe' },
    });
    const win = fakeContentWindow(handle.iframe);
    handle.setWallet({
      cosmos: {
        target: {},
        getOfflineSignerDirect: vi.fn(),
        getOfflineSignerAmino: vi.fn(),
      },
    });
    handle.clearWallet();
    expect(listenSpy).not.toHaveBeenCalled();
    expect(signalsTo(win)).toHaveLength(0);
    handle.destroy();
  });

  it('setWallet after destroy is inert', () => {
    const handle = mount(container, {
      referralId: 'val1',
      wallet: { mode: 'parent' },
    });
    const win = fakeContentWindow(handle.iframe);
    handle.destroy();
    win.postMessage.mockClear();
    listenSpy.mockClear();
    handle.setWallet({
      cosmos: {
        target: {},
        getOfflineSignerDirect: vi.fn(),
        getOfflineSignerAmino: vi.fn(),
      },
    });
    expect(listenSpy).not.toHaveBeenCalled();
    expect(signalsTo(win)).toHaveLength(0);
  });
});

describe('mount() - connect-prompt layer (spec A.4: onWalletConnectRequest + connectPrompt)', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    listenSpy.mockReset();
    listenSpy.mockReturnValue(() => {
      /* unlisten */
    });
    vi.spyOn(IframeClient.prototype, 'init').mockImplementation(
      () => new Promise(() => {
        /* never resolves */
      })
    );
  });

  afterEach(() => {
    container.remove();
    vi.restoreAllMocks();
  });

  function fakeContentWindow(iframe: HTMLIFrameElement): { postMessage: ReturnType<typeof vi.fn> } {
    const win = { postMessage: vi.fn() };
    Object.defineProperty(iframe, 'contentWindow', {
      configurable: true,
      get: () => win as unknown as Window,
    });
    return win;
  }
  function dispatch(iframe: HTMLIFrameElement, data: unknown): void {
    const event = new MessageEvent('message', { data, origin: WIDGET });
    Object.defineProperty(event, 'source', {
      configurable: true,
      get: () => iframe.contentWindow,
    });
    window.dispatchEvent(event);
  }
  function capsTo(win: { postMessage: ReturnType<typeof vi.fn> }): Array<Record<string, unknown>> {
    return win.postMessage.mock.calls
      .map((c) => c[0] as Record<string, unknown>)
      .filter((m) => m && m['ns'] === WALLET_SIGNAL_NS && m['kind'] === 'capabilities');
  }

  it('threads onWalletConnectRequest through: hello -> capabilities both true, connect-request invokes it', () => {
    const onWalletConnectRequest = vi.fn();
    const handle = mount(container, {
      referralId: 'val1',
      wallet: { mode: 'parent' },
      onWalletConnectRequest,
    });
    const win = fakeContentWindow(handle.iframe);

    dispatch(handle.iframe, { ns: WALLET_SIGNAL_NS, kind: 'hello' });
    const caps = capsTo(win);
    expect(caps).toHaveLength(1);
    expect(caps[0]?.['canRequestConnect']).toEqual({ cosmos: true, evm: true });

    dispatch(handle.iframe, { ns: WALLET_SIGNAL_NS, kind: 'connect-request', channel: 'cosmos' });
    expect(onWalletConnectRequest).toHaveBeenCalledWith('cosmos');
    handle.destroy();
  });

  it('threads connectPrompt through into the capabilities reply', () => {
    const handle = mount(container, {
      referralId: 'val1',
      wallet: { mode: 'parent' },
      connectPrompt: 'Connect on the parent page',
    });
    const win = fakeContentWindow(handle.iframe);

    dispatch(handle.iframe, { ns: WALLET_SIGNAL_NS, kind: 'hello' });
    const caps = capsTo(win);
    expect(caps).toHaveLength(1);
    expect(caps[0]?.['connectPrompt']).toBe('Connect on the parent page');
    // No handler -> both channels false.
    expect(caps[0]?.['canRequestConnect']).toEqual({ cosmos: false, evm: false });
    handle.destroy();
  });

  it('mode parent with no connect-prompt options still replies hello with both-false, no connectPrompt', () => {
    const handle = mount(container, {
      referralId: 'val1',
      wallet: { mode: 'parent' },
    });
    const win = fakeContentWindow(handle.iframe);
    dispatch(handle.iframe, { ns: WALLET_SIGNAL_NS, kind: 'hello' });
    const caps = capsTo(win);
    expect(caps).toHaveLength(1);
    expect(caps[0]?.['canRequestConnect']).toEqual({ cosmos: false, evm: false });
    expect('connectPrompt' in (caps[0] as object)).toBe(false);
    handle.destroy();
  });

  it('does NOT reply to hello in mode iframe (no controller, no capabilities)', () => {
    const onWalletConnectRequest = vi.fn();
    const handle = mount(container, {
      referralId: 'val1',
      wallet: { mode: 'iframe' },
      onWalletConnectRequest,
      connectPrompt: 'ignored',
    });
    const win = fakeContentWindow(handle.iframe);
    dispatch(handle.iframe, { ns: WALLET_SIGNAL_NS, kind: 'hello' });
    dispatch(handle.iframe, { ns: WALLET_SIGNAL_NS, kind: 'connect-request', channel: 'cosmos' });
    expect(capsTo(win)).toHaveLength(0);
    expect(onWalletConnectRequest).not.toHaveBeenCalled();
    handle.destroy();
  });
});
