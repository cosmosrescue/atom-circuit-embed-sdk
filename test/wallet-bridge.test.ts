/**
 * Parent-side wallet bridge tests.
 *
 * Covers the two channels wired by wireWalletBridge():
 * - Cosmos: Cosmiframe.listen is invoked with the iframe, the integrator's
 *   signer getters + target, and origins pinned to the widget origin (never
 *   '*'); teardown calls the returned unlisten fn.
 * - EVM: the custom atomcircuit:evm envelope relay - request/response/error
 *   round-trip with id echo, provider event forwarding, strict origin + source
 *   validation (adversarial), malformed-envelope rejection, unknown-method
 *   surfaced as an error response (not a crash), and full listener teardown.
 *
 * Cosmiframe is mocked so these tests pin OUR contract (the params we pass and
 * the teardown wiring), not cosmiframe's internals which it tests itself.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { EVM_BRIDGE_NS, WALLET_SIGNAL_NS } from '../src/protocol.js';
import type { Eip1193ProviderLike, WalletEvmHandle } from '../src/protocol.js';

/**
 * Wiring a channel posts the Appendix A.4 `ready` signal and teardown posts
 * `gone`, both on the same iframe.contentWindow.postMessage spy as the EVM
 * relay. Tests that assert on EVM traffic filter those signals out via these
 * helpers so the signal posts (covered explicitly elsewhere) do not perturb
 * call-index-based assertions on EVM messages.
 */
function isSignal(msg: unknown): boolean {
  return (
    typeof msg === 'object' &&
    msg !== null &&
    (msg as { ns?: unknown }).ns === WALLET_SIGNAL_NS
  );
}
function evmPosts(
  spy: ReturnType<typeof vi.fn>
): Array<[Record<string, unknown>, string]> {
  return spy.mock.calls.filter(
    (c) => !isSignal(c[0])
  ) as Array<[Record<string, unknown>, string]>;
}
function signalPosts(
  spy: ReturnType<typeof vi.fn>
): Array<[Record<string, unknown>, string]> {
  return spy.mock.calls.filter((c) => isSignal(c[0])) as Array<
    [Record<string, unknown>, string]
  >;
}

// Mock cosmiframe BEFORE importing the bridge so the named export is the spy.
const listenSpy = vi.fn<(opts: unknown) => () => void>();
vi.mock('@dao-dao/cosmiframe', () => ({
  Cosmiframe: {
    listen: (opts: unknown): (() => void) => listenSpy(opts),
  },
}));

// Imported after the mock is registered.
import {
  wireWalletBridge,
  createWalletBridge,
  resolveWidgetOrigin,
} from '../src/wallet-bridge.js';

const WIDGET = 'https://atomcircuit.net';

/** Drain microtasks so the provider.request().then/.catch chain settles. */
async function flush(): Promise<void> {
  for (let i = 0; i < 8; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await Promise.resolve();
  }
}

/**
 * Build an iframe whose contentWindow is a stub that records posted messages.
 * jsdom's real iframe.contentWindow is read-only and cross-origin-throwy, so
 * we define a fake one carrying a postMessage spy.
 */
interface FakeWindow {
  postMessage: ReturnType<typeof vi.fn>;
}
function makeIframe(): { iframe: HTMLIFrameElement; win: FakeWindow } {
  const iframe = document.createElement('iframe');
  const win: FakeWindow = { postMessage: vi.fn() };
  Object.defineProperty(iframe, 'contentWindow', {
    configurable: true,
    get: () => win as unknown as Window,
  });
  return { iframe, win };
}

/** Dispatch a window 'message' event with controllable origin + source. */
function dispatchMessage(opts: {
  data: unknown;
  origin: string;
  source: Window | null;
}): void {
  const event = new MessageEvent('message', {
    data: opts.data,
    origin: opts.origin,
  });
  // MessageEvent.source is read-only via the constructor in jsdom; override it.
  Object.defineProperty(event, 'source', {
    configurable: true,
    get: () => opts.source,
  });
  window.dispatchEvent(event);
}

describe('resolveWidgetOrigin()', () => {
  it('returns the canonical widget origin when input is empty', () => {
    expect(resolveWidgetOrigin()).toBe(WIDGET);
    expect(resolveWidgetOrigin('')).toBe(WIDGET);
  });

  it('normalizes a URL with a path/trailing slash to a bare origin', () => {
    expect(resolveWidgetOrigin('https://atomcircuit.net/embed/swap')).toBe(WIDGET);
    expect(resolveWidgetOrigin('https://atomcircuit.net/')).toBe(WIDGET);
    expect(resolveWidgetOrigin('https://staging.example.com:8443/x')).toBe(
      'https://staging.example.com:8443'
    );
  });

  it('falls back to the canonical origin (never widens) for an unparseable input', () => {
    expect(resolveWidgetOrigin('/relative/path')).toBe(WIDGET);
  });
});

describe('wireWalletBridge() - Cosmos channel', () => {
  beforeEach(() => {
    listenSpy.mockReset();
    listenSpy.mockReturnValue(() => {
      /* unlisten */
    });
  });

  it('calls Cosmiframe.listen with the iframe, signer getters, and origins pinned to the widget origin', () => {
    const { iframe } = makeIframe();
    const getOfflineSignerDirect = vi.fn();
    const getOfflineSignerAmino = vi.fn();
    const target = { getKey: vi.fn() };

    const handle = wireWalletBridge({
      iframe,
      widgetOrigin: WIDGET,
      cosmos: {
        target,
        getOfflineSignerDirect,
        getOfflineSignerAmino,
        metadata: { name: 'HighStakes' },
      },
    });

    // The listener is installed once at controller creation (parent mode),
    // before the handle is applied, so only one listen() call regardless of
    // setWallet replays.
    expect(listenSpy).toHaveBeenCalledTimes(1);
    const arg = listenSpy.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(arg['iframe']).toBe(iframe);
    expect(arg['origins']).toEqual([WIDGET]);
    // Never '*', never a wildcard.
    expect(arg['origins']).not.toContain('*');
    // target is the lazy dispatch proxy (not the raw wallet object): it reports
    // every string method as present (has trap) and callable (get trap) so
    // cosmiframe's `s in target && typeof target[s] === 'function'` gate passes,
    // then dispatches to the currently-held handle's real target.
    const proxy = arg['target'] as Record<string, unknown>;
    expect('getKey' in proxy).toBe(true);
    expect(typeof proxy['getKey']).toBe('function');
    // The proxy dispatches to the held handle's real target method.
    (proxy['getKey'] as () => void)();
    expect(target.getKey).toHaveBeenCalledTimes(1);
    // metadata is the stable view object cosmiframe captured (a plain object,
    // never a function), carrying the handle's metadata after setWallet.
    expect(typeof arg['metadata']).toBe('object');
    expect(arg['metadata']).toEqual({ name: 'HighStakes' });
    handle.teardown();
  });

  it('passes metadata as a stable plain object (a function would break the getMetadata clone), empty before a handle has metadata', () => {
    const { iframe } = makeIframe();
    const handle = wireWalletBridge({
      iframe,
      widgetOrigin: WIDGET,
      cosmos: {
        target: {},
        getOfflineSignerDirect: vi.fn(),
        getOfflineSignerAmino: vi.fn(),
      },
    });
    const arg = listenSpy.mock.calls[0]?.[0] as Record<string, unknown>;
    // Always present and always a plain object, never a function (cosmiframe
    // structured-clones this across postMessage; a function throws DataCloneError).
    expect('metadata' in arg).toBe(true);
    expect(typeof arg['metadata']).toBe('object');
    expect(typeof arg['metadata']).not.toBe('function');
    // No metadata on the handle -> empty object (cosmiframe answers it as-is).
    expect(arg['metadata']).toEqual({});
    handle.teardown();
  });

  it('teardown calls the unlisten function returned by Cosmiframe.listen', () => {
    const unlisten = vi.fn();
    listenSpy.mockReturnValue(unlisten);
    const { iframe } = makeIframe();
    const handle = wireWalletBridge({
      iframe,
      widgetOrigin: WIDGET,
      cosmos: {
        target: {},
        getOfflineSignerDirect: vi.fn(),
        getOfflineSignerAmino: vi.fn(),
      },
    });
    expect(unlisten).not.toHaveBeenCalled();
    handle.teardown();
    expect(unlisten).toHaveBeenCalledTimes(1);
    // Idempotent.
    handle.teardown();
    expect(unlisten).toHaveBeenCalledTimes(1);
  });

  it('does NOT relay EVM requests when only cosmos is supplied (control listener present, no EVM relay)', async () => {
    const { iframe } = makeIframe();
    const handle = wireWalletBridge({
      iframe,
      widgetOrigin: WIDGET,
      cosmos: {
        target: {},
        getOfflineSignerDirect: vi.fn(),
        getOfflineSignerAmino: vi.fn(),
      },
    });
    // A control listener IS attached (it serves hello/connect-request and is
    // independent of any wallet handle), but there is no EVM relay: an inbound
    // EVM request envelope is silently ignored because no provider is wired.
    // We assert that indirectly - nothing throws and the cosmos channel alone
    // was wired via Cosmiframe.listen.
    expect(listenSpy).toHaveBeenCalledTimes(1);
    expect(() =>
      dispatchMessage({
        data: { ns: EVM_BRIDGE_NS, kind: 'request', id: 'x', method: 'eth_chainId' },
        origin: WIDGET,
        source: iframe.contentWindow,
      })
    ).not.toThrow();
    await flush();
    handle.teardown();
  });
});

describe('wireWalletBridge() - EVM channel', () => {
  beforeEach(() => {
    listenSpy.mockReset();
    listenSpy.mockReturnValue(() => {
      /* unlisten */
    });
  });

  function makeProvider(
    overrides: Partial<Eip1193ProviderLike> = {}
  ): {
    provider: Eip1193ProviderLike;
    handlers: Map<string, (...args: unknown[]) => void>;
    request: ReturnType<typeof vi.fn>;
    removeListener: ReturnType<typeof vi.fn>;
  } {
    const handlers = new Map<string, (...args: unknown[]) => void>();
    const request = vi.fn();
    const removeListener = vi.fn(
      (event: string, _l: (...a: unknown[]) => void) => {
        handlers.delete(event);
      }
    );
    const provider: Eip1193ProviderLike = {
      request,
      on: (event: string, listener: (...args: unknown[]) => void) => {
        handlers.set(event, listener);
      },
      removeListener: removeListener as unknown as Eip1193ProviderLike['removeListener'],
      ...overrides,
    };
    return { provider, handlers, request, removeListener };
  }

  it('relays a valid request to provider.request and posts back the result with the echoed id', async () => {
    const { iframe, win } = makeIframe();
    const { provider, request } = makeProvider();
    request.mockResolvedValue('0x1');

    wireWalletBridge({
      iframe,
      widgetOrigin: WIDGET,
      evm: { provider } as WalletEvmHandle,
    });

    dispatchMessage({
      data: {
        ns: EVM_BRIDGE_NS,
        kind: 'request',
        id: 'req-1',
        method: 'eth_chainId',
        params: [],
      },
      origin: WIDGET,
      source: iframe.contentWindow,
    });
    await flush();

    expect(request).toHaveBeenCalledWith({ method: 'eth_chainId', params: [] });
    // Exactly one EVM response (the A.4 'ready' signal post is filtered out;
    // it is asserted separately below).
    const evm = evmPosts(win.postMessage);
    expect(evm).toHaveLength(1);
    const [msg, targetOrigin] = evm[0] as [Record<string, unknown>, string];
    expect(msg).toEqual({
      ns: EVM_BRIDGE_NS,
      kind: 'response',
      id: 'req-1',
      result: '0x1',
    });
    // Outbound never '*'.
    expect(targetOrigin).toBe(WIDGET);
    // Wiring the evm channel announced it via the A.4 ready signal.
    const signals = signalPosts(win.postMessage);
    expect(signals).toHaveLength(1);
    expect(signals[0]?.[0]).toEqual({
      ns: WALLET_SIGNAL_NS,
      kind: 'ready',
      channels: ['evm'],
    });
    expect(signals[0]?.[1]).toBe(WIDGET);
  });

  it('omits params from the provider call when the request carries none', async () => {
    const { iframe } = makeIframe();
    const { provider, request } = makeProvider();
    request.mockResolvedValue(null);

    wireWalletBridge({
      iframe,
      widgetOrigin: WIDGET,
      evm: { provider },
    });
    dispatchMessage({
      data: { ns: EVM_BRIDGE_NS, kind: 'request', id: 'r', method: 'eth_accounts' },
      origin: WIDGET,
      source: iframe.contentWindow,
    });
    await flush();
    expect(request).toHaveBeenCalledWith({ method: 'eth_accounts' });
  });

  it('posts an error response (echoed id, preserved code/message) when the provider rejects', async () => {
    const { iframe, win } = makeIframe();
    const { provider, request } = makeProvider();
    request.mockRejectedValue({ code: 4001, message: 'User rejected the request' });

    wireWalletBridge({ iframe, widgetOrigin: WIDGET, evm: { provider } });
    dispatchMessage({
      data: {
        ns: EVM_BRIDGE_NS,
        kind: 'request',
        id: 'req-2',
        method: 'eth_sendTransaction',
        params: [{}],
      },
      origin: WIDGET,
      source: iframe.contentWindow,
    });
    await flush();

    const [msg] = evmPosts(win.postMessage)[0] as [Record<string, unknown>, string];
    expect(msg).toEqual({
      ns: EVM_BRIDGE_NS,
      kind: 'response',
      id: 'req-2',
      error: { code: 4001, message: 'User rejected the request' },
    });
  });

  it('surfaces an unknown/unstructured provider throw as an internal-error response, not a crash', async () => {
    const { iframe, win } = makeIframe();
    const { provider, request } = makeProvider();
    // A plain string throw with no code/message structure.
    request.mockRejectedValue('boom');

    wireWalletBridge({ iframe, widgetOrigin: WIDGET, evm: { provider } });
    dispatchMessage({
      data: {
        ns: EVM_BRIDGE_NS,
        kind: 'request',
        id: 'req-3',
        method: 'eth_unknownMethod',
        params: [],
      },
      origin: WIDGET,
      source: iframe.contentWindow,
    });
    await flush();

    const [msg] = evmPosts(win.postMessage)[0] as [Record<string, unknown>, string];
    expect((msg['error'] as { code: number }).code).toBe(-32603);
    expect((msg['error'] as { message: string }).message).toBe('boom');
    expect(msg['kind']).toBe('response');
    expect(msg['id']).toBe('req-3');
  });

  it('drops a NON-INTEGER provider error code (NaN / float) and falls back to the internal-error code', async () => {
    const { iframe, win } = makeIframe();
    const { provider, request } = makeProvider();
    // A provider that rejects with a float/NaN code (malformed): the relay must
    // not forward a nonsensical code on the wire.
    request.mockRejectedValue({ code: 4.2, message: 'floaty' });

    wireWalletBridge({ iframe, widgetOrigin: WIDGET, evm: { provider } });
    dispatchMessage({
      data: { ns: EVM_BRIDGE_NS, kind: 'request', id: 'req-float', method: 'eth_x', params: [] },
      origin: WIDGET,
      source: iframe.contentWindow,
    });
    await flush();
    const [msg] = evmPosts(win.postMessage)[0] as [Record<string, unknown>, string];
    expect((msg['error'] as { code: number }).code).toBe(-32603);
    // Message is still preserved even though the code was dropped.
    expect((msg['error'] as { message: string }).message).toBe('floaty');

    // And NaN code: also dropped.
    win.postMessage.mockClear();
    request.mockRejectedValue({ code: Number.NaN, message: 'nany' });
    dispatchMessage({
      data: { ns: EVM_BRIDGE_NS, kind: 'request', id: 'req-nan', method: 'eth_y', params: [] },
      origin: WIDGET,
      source: iframe.contentWindow,
    });
    await flush();
    const [msg2] = evmPosts(win.postMessage)[0] as [Record<string, unknown>, string];
    expect((msg2['error'] as { code: number }).code).toBe(-32603);
  });

  it('PRESERVES an integer provider error code (e.g. 4001 user-rejected)', async () => {
    const { iframe, win } = makeIframe();
    const { provider, request } = makeProvider();
    request.mockRejectedValue({ code: 4001, message: 'rejected' });
    wireWalletBridge({ iframe, widgetOrigin: WIDGET, evm: { provider } });
    dispatchMessage({
      data: { ns: EVM_BRIDGE_NS, kind: 'request', id: 'req-int', method: 'eth_z', params: [] },
      origin: WIDGET,
      source: iframe.contentWindow,
    });
    await flush();
    const [msg] = evmPosts(win.postMessage)[0] as [Record<string, unknown>, string];
    expect((msg['error'] as { code: number }).code).toBe(4001);
  });

  it('forwards accountsChanged / chainChanged / disconnect provider events to the iframe origin', () => {
    const { iframe, win } = makeIframe();
    const { provider, handlers } = makeProvider();

    wireWalletBridge({ iframe, widgetOrigin: WIDGET, evm: { provider } });

    handlers.get('accountsChanged')?.(['0xabc', '0xdef']);
    handlers.get('chainChanged')?.('0x1');
    handlers.get('disconnect')?.();

    const posts = win.postMessage.mock.calls.map((c) => c[0]);
    expect(posts).toContainEqual({
      ns: EVM_BRIDGE_NS,
      kind: 'event',
      event: 'accountsChanged',
      accounts: ['0xabc', '0xdef'],
    });
    expect(posts).toContainEqual({
      ns: EVM_BRIDGE_NS,
      kind: 'event',
      event: 'chainChanged',
      chainId: '0x1',
    });
    expect(posts).toContainEqual({
      ns: EVM_BRIDGE_NS,
      kind: 'event',
      event: 'disconnect',
    });
    // Every event targeted the widget origin, never '*'.
    for (const call of win.postMessage.mock.calls) {
      expect(call[1]).toBe(WIDGET);
    }
  });

  it('forwards the EIP-1193 disconnect ERROR argument when present (does not silently drop args[0])', () => {
    const { iframe, win } = makeIframe();
    const { provider, handlers } = makeProvider();
    wireWalletBridge({ iframe, widgetOrigin: WIDGET, evm: { provider } });

    // EIP-1193 disconnect delivers a ProviderRpcError { code, message }.
    handlers.get('disconnect')?.({ code: 4900, message: 'Disconnected' });

    const posts = win.postMessage.mock.calls.map((c) => c[0]);
    expect(posts).toContainEqual({
      ns: EVM_BRIDGE_NS,
      kind: 'event',
      event: 'disconnect',
      error: { code: 4900, message: 'Disconnected' },
    });
  });

  it('omits the disconnect error field when the provider fires disconnect with no argument', () => {
    const { iframe, win } = makeIframe();
    const { provider, handlers } = makeProvider();
    wireWalletBridge({ iframe, widgetOrigin: WIDGET, evm: { provider } });

    handlers.get('disconnect')?.();

    const posts = win.postMessage.mock.calls.map((c) => c[0]);
    expect(posts).toContainEqual({
      ns: EVM_BRIDGE_NS,
      kind: 'event',
      event: 'disconnect',
    });
    // Defensive: no entry carries an error field for the no-arg case.
    const disconnects = posts.filter(
      (p) =>
        p &&
        typeof p === 'object' &&
        (p as Record<string, unknown>)['event'] === 'disconnect'
    );
    for (const d of disconnects) {
      expect('error' in (d as Record<string, unknown>)).toBe(false);
    }
  });

  it('does not subscribe to events when the provider has no on()', () => {
    const { iframe, win } = makeIframe();
    const request = vi.fn().mockResolvedValue('ok');
    // Provider with request only (no on / removeListener).
    const provider: Eip1193ProviderLike = { request };
    const handle = wireWalletBridge({
      iframe,
      widgetOrigin: WIDGET,
      evm: { provider },
    });
    // request relay still works.
    dispatchMessage({
      data: { ns: EVM_BRIDGE_NS, kind: 'request', id: 'x', method: 'eth_chainId' },
      origin: WIDGET,
      source: iframe.contentWindow,
    });
    expect(() => handle.teardown()).not.toThrow();
    expect(win.postMessage).toBeDefined();
  });

  /* ----------------------------- adversarial ---------------------------- */

  it('IGNORES an inbound message from the wrong origin', async () => {
    const { iframe, win } = makeIframe();
    const { provider, request } = makeProvider();
    request.mockResolvedValue('0x1');

    wireWalletBridge({ iframe, widgetOrigin: WIDGET, evm: { provider } });
    dispatchMessage({
      data: { ns: EVM_BRIDGE_NS, kind: 'request', id: 'evil', method: 'eth_chainId' },
      origin: 'https://attacker.example',
      source: iframe.contentWindow,
    });
    await flush();
    expect(request).not.toHaveBeenCalled();
    // The bridge never relays the wrong-origin request; the only post is the
    // A.4 ready signal emitted at wire time (not an EVM response).
    expect(evmPosts(win.postMessage)).toHaveLength(0);
  });

  it('IGNORES an inbound message from the wrong source window', async () => {
    const { iframe } = makeIframe();
    const { provider, request } = makeProvider();
    request.mockResolvedValue('0x1');

    wireWalletBridge({ iframe, widgetOrigin: WIDGET, evm: { provider } });
    // Right origin, but a different source window than iframe.contentWindow.
    const otherWindow = { postMessage: vi.fn() } as unknown as Window;
    dispatchMessage({
      data: { ns: EVM_BRIDGE_NS, kind: 'request', id: 'evil', method: 'eth_chainId' },
      origin: WIDGET,
      source: otherWindow,
    });
    await flush();
    expect(request).not.toHaveBeenCalled();
  });

  it('IGNORES a malformed / wrong-namespace / missing-field envelope', async () => {
    const { iframe } = makeIframe();
    const { provider, request } = makeProvider();
    request.mockResolvedValue('0x1');

    wireWalletBridge({ iframe, widgetOrigin: WIDGET, evm: { provider } });

    const bad: unknown[] = [
      null,
      'a string',
      42,
      { kind: 'request', id: 'x', method: 'eth_chainId' }, // missing ns
      { ns: 'wrong:ns', kind: 'request', id: 'x', method: 'eth_chainId' }, // wrong ns
      { ns: EVM_BRIDGE_NS, kind: 'response', id: 'x', result: 1 }, // not a request
      { ns: EVM_BRIDGE_NS, kind: 'request', id: 'x' }, // missing method
      { ns: EVM_BRIDGE_NS, kind: 'request', method: 'eth_chainId' }, // missing id
      { ns: EVM_BRIDGE_NS, kind: 'request', id: 1, method: 'eth_chainId' }, // non-string id
      { ns: EVM_BRIDGE_NS, kind: 'request', id: 'x', method: 'eth_chainId', params: 'nope' }, // params not array
    ];
    for (const data of bad) {
      dispatchMessage({ data, origin: WIDGET, source: iframe.contentWindow });
    }
    await flush();
    expect(request).not.toHaveBeenCalled();
  });

  it('teardown removes the message listener AND the provider event subscriptions (no leak)', async () => {
    const { iframe, win } = makeIframe();
    const { provider, request, removeListener, handlers } = makeProvider();
    request.mockResolvedValue('0x1');

    const handle = wireWalletBridge({
      iframe,
      widgetOrigin: WIDGET,
      evm: { provider },
    });
    handle.teardown();

    // All three provider events unsubscribed.
    expect(removeListener).toHaveBeenCalledTimes(3);
    const removed = removeListener.mock.calls.map((c) => c[0]);
    expect(removed).toEqual(
      expect.arrayContaining(['accountsChanged', 'chainChanged', 'disconnect'])
    );
    // handlers map drained by the removeListener stub.
    expect(handlers.size).toBe(0);

    // Teardown announced the channel removal via the A.4 'gone' signal.
    const signals = signalPosts(win.postMessage);
    expect(signals).toHaveLength(2); // ready on wire, gone on teardown.
    expect(signals[1]?.[0]).toEqual({
      ns: WALLET_SIGNAL_NS,
      kind: 'gone',
      channels: ['evm'],
    });

    // The window message listener is gone: a post-teardown request is ignored.
    const postsBeforeLate = win.postMessage.mock.calls.length;
    dispatchMessage({
      data: { ns: EVM_BRIDGE_NS, kind: 'request', id: 'late', method: 'eth_chainId' },
      origin: WIDGET,
      source: iframe.contentWindow,
    });
    await flush();
    expect(request).not.toHaveBeenCalled();
    // No NEW posts after teardown beyond the 'gone' signal already counted.
    expect(win.postMessage.mock.calls.length).toBe(postsBeforeLate);
    expect(evmPosts(win.postMessage)).toHaveLength(0);
  });
});

describe('wireWalletBridge() - both channels', () => {
  beforeEach(() => {
    listenSpy.mockReset();
    listenSpy.mockReturnValue(() => {
      /* unlisten */
    });
  });

  it('wires cosmos AND evm when both handles are supplied', async () => {
    const { iframe } = makeIframe();
    const request = vi.fn().mockResolvedValue('0x1');
    const provider: Eip1193ProviderLike = {
      request,
      on: vi.fn(),
      removeListener: vi.fn(),
    };
    const unlisten = vi.fn();
    listenSpy.mockReturnValue(unlisten);

    const handle = wireWalletBridge({
      iframe,
      widgetOrigin: WIDGET,
      cosmos: {
        target: {},
        getOfflineSignerDirect: vi.fn(),
        getOfflineSignerAmino: vi.fn(),
      },
      evm: { provider },
    });

    expect(listenSpy).toHaveBeenCalledTimes(1);
    dispatchMessage({
      data: { ns: EVM_BRIDGE_NS, kind: 'request', id: 'b', method: 'eth_chainId' },
      origin: WIDGET,
      source: iframe.contentWindow,
    });
    await flush();
    expect(request).toHaveBeenCalledTimes(1);

    handle.teardown();
    expect(unlisten).toHaveBeenCalledTimes(1);
  });
});

/* ------------------------------------------------------------------------- */
/* createWalletBridge controller (spec A.5: setWallet / clearWallet, late)    */
/* ------------------------------------------------------------------------- */

describe('createWalletBridge() - signal contract (A.4 ready/gone)', () => {
  beforeEach(() => {
    listenSpy.mockReset();
    listenSpy.mockReturnValue(() => {
      /* unlisten */
    });
  });

  function cosmosHandle() {
    return {
      target: { getKey: vi.fn() },
      getOfflineSignerDirect: vi.fn(),
      getOfflineSignerAmino: vi.fn(),
    };
  }
  function evmHandle(): WalletEvmHandle {
    return { provider: { request: vi.fn().mockResolvedValue('0x1') } };
  }

  it('setWallet wires the channel(s) and posts a ready signal to the iframe origin (never *)', () => {
    const { iframe, win } = makeIframe();
    const ctrl = createWalletBridge({ iframe, widgetOrigin: WIDGET });

    ctrl.setWallet({ cosmos: cosmosHandle() });
    expect(listenSpy).toHaveBeenCalledTimes(1);

    const signals = signalPosts(win.postMessage);
    expect(signals).toHaveLength(1);
    expect(signals[0]?.[0]).toEqual({
      ns: WALLET_SIGNAL_NS,
      kind: 'ready',
      channels: ['cosmos'],
    });
    // Targeted the iframe origin explicitly, never '*'.
    expect(signals[0]?.[1]).toBe(WIDGET);
    ctrl.teardown();
  });

  it('setWallet with both channels posts a single ready listing both', () => {
    const { iframe, win } = makeIframe();
    const ctrl = createWalletBridge({ iframe, widgetOrigin: WIDGET });
    ctrl.setWallet({ cosmos: cosmosHandle(), evm: evmHandle() });
    const signals = signalPosts(win.postMessage);
    expect(signals).toHaveLength(1);
    expect(signals[0]?.[0]).toEqual({
      ns: WALLET_SIGNAL_NS,
      kind: 'ready',
      channels: ['cosmos', 'evm'],
    });
    ctrl.teardown();
  });

  it('LATE setWallet (controller created with no handles) wires the bridge and posts ready', async () => {
    const { iframe, win } = makeIframe();
    const ctrl = createWalletBridge({ iframe, widgetOrigin: WIDGET });
    // The cosmiframe listener is installed at creation (parent mode) so the
    // parent answers the child's mount-time handshake even with NO wallet.
    expect(listenSpy).toHaveBeenCalledTimes(1);
    // No logical channel adopted yet -> no `ready` signal posted (option Y:
    // widget visible before connect).
    expect(signalPosts(win.postMessage)).toHaveLength(0);

    // Later, the integrator connects -> setWallet. The bridge wires AND the
    // EVM relay starts working.
    const evm = evmHandle();
    ctrl.setWallet({ evm });
    const signals = signalPosts(win.postMessage);
    expect(signals).toHaveLength(1);
    expect(signals[0]?.[0]).toEqual({
      ns: WALLET_SIGNAL_NS,
      kind: 'ready',
      channels: ['evm'],
    });

    // The relay is live now.
    dispatchMessage({
      data: { ns: EVM_BRIDGE_NS, kind: 'request', id: 'late-ok', method: 'eth_chainId' },
      origin: WIDGET,
      source: iframe.contentWindow,
    });
    await flush();
    expect((evm.provider.request as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith({
      method: 'eth_chainId',
    });
    ctrl.teardown();
  });

  it('clearWallet tears down the channel and posts a gone signal', () => {
    const { iframe, win } = makeIframe();
    const ctrl = createWalletBridge({ iframe, widgetOrigin: WIDGET });
    ctrl.setWallet({ cosmos: cosmosHandle(), evm: evmHandle() });
    win.postMessage.mockClear();

    ctrl.clearWallet(['cosmos']);
    const signals = signalPosts(win.postMessage);
    expect(signals).toHaveLength(1);
    expect(signals[0]?.[0]).toEqual({
      ns: WALLET_SIGNAL_NS,
      kind: 'gone',
      channels: ['cosmos'],
    });
    ctrl.teardown();
  });

  it('clearWallet with no args clears every wired channel', () => {
    const { iframe, win } = makeIframe();
    const ctrl = createWalletBridge({ iframe, widgetOrigin: WIDGET });
    ctrl.setWallet({ cosmos: cosmosHandle(), evm: evmHandle() });
    win.postMessage.mockClear();

    ctrl.clearWallet();
    const signals = signalPosts(win.postMessage);
    expect(signals).toHaveLength(1);
    const msg = signals[0]?.[0] as { channels: string[] };
    expect(msg.channels).toEqual(expect.arrayContaining(['cosmos', 'evm']));
    ctrl.teardown();
  });

  it('clearWallet on a channel that was never wired posts NO gone signal', () => {
    const { iframe, win } = makeIframe();
    const ctrl = createWalletBridge({ iframe, widgetOrigin: WIDGET });
    ctrl.setWallet({ cosmos: cosmosHandle() });
    win.postMessage.mockClear();

    ctrl.clearWallet(['evm']); // evm was never wired
    expect(signalPosts(win.postMessage)).toHaveLength(0);
    ctrl.teardown();
  });

  it('BUG A: re-setWallet on an already-wired cosmos channel swaps the held handle (single listener) and posts the cosmiframe_keystorechange relay, NOT a repeat ready', () => {
    const { iframe, win } = makeIframe();
    const unlisten = vi.fn();
    listenSpy.mockReturnValue(unlisten);

    const ctrl = createWalletBridge({ iframe, widgetOrigin: WIDGET });
    // The cosmiframe listener is installed ONCE at creation. Account switches do
    // not re-create it; they swap the held handle behind the same listener.
    expect(listenSpy).toHaveBeenCalledTimes(1);

    // FIRST wire posts 'ready' (adoption).
    ctrl.setWallet({ cosmos: cosmosHandle() });
    const firstReady = signalPosts(win.postMessage);
    expect(firstReady).toHaveLength(1);
    expect(firstReady[0]?.[0]).toEqual({
      ns: WALLET_SIGNAL_NS,
      kind: 'ready',
      channels: ['cosmos'],
    });
    win.postMessage.mockClear();

    // Re-set with a fresh cosmos handle (account switched): the single listener
    // is NOT torn down or re-created; only the held handle is swapped.
    ctrl.setWallet({ cosmos: cosmosHandle() });
    expect(unlisten).not.toHaveBeenCalled();
    expect(listenSpy).toHaveBeenCalledTimes(1);

    // NO repeat A.4 'ready' (the dapp no-ops a repeat ready on an adopted channel).
    expect(signalPosts(win.postMessage)).toHaveLength(0);

    // Instead, exactly the cosmos-kit native keystorechange relay, targeted at
    // the iframe origin (never '*').
    const allPosts = win.postMessage.mock.calls;
    expect(allPosts).toHaveLength(1);
    expect(allPosts[0]?.[0]).toEqual({ event: 'cosmiframe_keystorechange' });
    expect(allPosts[0]?.[1]).toBe(WIDGET);

    // The single listener is torn down on full controller teardown.
    ctrl.teardown();
    expect(unlisten).toHaveBeenCalledTimes(1);
  });

  it('BUG A: the FIRST wire of a cosmos channel posts ready, NOT the keystorechange relay', () => {
    const { iframe, win } = makeIframe();
    const ctrl = createWalletBridge({ iframe, widgetOrigin: WIDGET });

    ctrl.setWallet({ cosmos: cosmosHandle() });

    const posts = win.postMessage.mock.calls;
    // Exactly one post: the A.4 ready. No keystorechange relay on first wire.
    expect(posts).toHaveLength(1);
    expect(posts[0]?.[0]).toEqual({
      ns: WALLET_SIGNAL_NS,
      kind: 'ready',
      channels: ['cosmos'],
    });
    expect(
      posts.some(
        (c) => (c[0] as { event?: unknown }).event === 'cosmiframe_keystorechange'
      )
    ).toBe(false);
    ctrl.teardown();
  });

  it('BUG A: re-setWallet on an already-wired EVM channel re-wires WITHOUT a keystorechange relay and without a repeat ready (EVM uses accountsChanged)', () => {
    const { iframe, win } = makeIframe();
    const ctrl = createWalletBridge({ iframe, widgetOrigin: WIDGET });
    ctrl.setWallet({ evm: evmHandle() });
    win.postMessage.mockClear();

    ctrl.setWallet({ evm: evmHandle() });
    // No repeat ready and no cosmos keystorechange relay (EVM account changes
    // propagate via the provider's own accountsChanged forwarding).
    expect(signalPosts(win.postMessage)).toHaveLength(0);
    expect(
      win.postMessage.mock.calls.some(
        (c) => (c[0] as { event?: unknown }).event === 'cosmiframe_keystorechange'
      )
    ).toBe(false);
    ctrl.teardown();
  });

  it('teardown posts gone for all wired channels and is idempotent', () => {
    const { iframe, win } = makeIframe();
    const ctrl = createWalletBridge({ iframe, widgetOrigin: WIDGET });
    ctrl.setWallet({ cosmos: cosmosHandle(), evm: evmHandle() });
    win.postMessage.mockClear();

    ctrl.teardown();
    expect(signalPosts(win.postMessage)).toHaveLength(1);
    win.postMessage.mockClear();
    // Idempotent: a second teardown does nothing.
    ctrl.teardown();
    expect(signalPosts(win.postMessage)).toHaveLength(0);
  });

  it('REGRESSION: teardown does NOT throw when the iframe contentWindow.postMessage throws (detached iframe)', () => {
    // jsdom / a real browser throws from postMessage on a detached or
    // cross-origin-throwy contentWindow. Teardown posts a `gone` signal and
    // must never let that throw bubble up (React unmount crashed otherwise).
    const iframe = document.createElement('iframe');
    const throwingWin = {
      postMessage: vi.fn(() => {
        throw new Error('Cannot read properties of null (reading "_origin")');
      }),
    };
    Object.defineProperty(iframe, 'contentWindow', {
      configurable: true,
      get: () => throwingWin as unknown as Window,
    });
    const ctrl = createWalletBridge({ iframe, widgetOrigin: WIDGET });
    ctrl.setWallet({ evm: evmHandle() });
    expect(() => ctrl.teardown()).not.toThrow();
    expect(throwingWin.postMessage).toHaveBeenCalled();
  });

  it('after teardown, setWallet / clearWallet are inert (no wiring, no signals)', () => {
    const { iframe, win } = makeIframe();
    const ctrl = createWalletBridge({ iframe, widgetOrigin: WIDGET });
    ctrl.teardown();
    win.postMessage.mockClear();
    listenSpy.mockClear();

    ctrl.setWallet({ cosmos: cosmosHandle() });
    ctrl.clearWallet();
    expect(listenSpy).not.toHaveBeenCalled();
    expect(signalPosts(win.postMessage)).toHaveLength(0);
  });

  /* ----------------------------- adversarial ---------------------------- */

  it('the EVM relay STILL rejects wrong-origin / wrong-source messages after setWallet', async () => {
    const { iframe, win } = makeIframe();
    const evm = evmHandle();
    const ctrl = createWalletBridge({ iframe, widgetOrigin: WIDGET });
    ctrl.setWallet({ evm });
    win.postMessage.mockClear();

    // Wrong origin.
    dispatchMessage({
      data: { ns: EVM_BRIDGE_NS, kind: 'request', id: 'e1', method: 'eth_chainId' },
      origin: 'https://attacker.example',
      source: iframe.contentWindow,
    });
    // Wrong source.
    dispatchMessage({
      data: { ns: EVM_BRIDGE_NS, kind: 'request', id: 'e2', method: 'eth_chainId' },
      origin: WIDGET,
      source: { postMessage: vi.fn() } as unknown as Window,
    });
    await flush();
    expect((evm.provider.request as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
    // No EVM responses emitted for the rejected messages.
    expect(evmPosts(win.postMessage)).toHaveLength(0);
    ctrl.teardown();
  });
});

/* ------------------------------------------------------------------------- */
/* createWalletBridge control channel (A.4 hello / capabilities /            */
/* connect-request) - the connect-prompt layer (option Y refinement)         */
/* ------------------------------------------------------------------------- */

describe('createWalletBridge() - control channel (A.4 hello/capabilities/connect-request)', () => {
  beforeEach(() => {
    listenSpy.mockReset();
    listenSpy.mockReturnValue(() => {
      /* unlisten */
    });
  });

  function cosmosHandle() {
    return {
      target: { getKey: vi.fn() },
      getOfflineSignerDirect: vi.fn(),
      getOfflineSignerAmino: vi.fn(),
    };
  }
  function evmHandle(): WalletEvmHandle {
    return { provider: { request: vi.fn().mockResolvedValue('0x1') } };
  }

  /** Capabilities posts (parent -> iframe) only. */
  function capabilitiesPosts(
    spy: ReturnType<typeof vi.fn>
  ): Array<[Record<string, unknown>, string]> {
    return spy.mock.calls.filter(
      (c) =>
        isSignal(c[0]) &&
        (c[0] as { kind?: unknown }).kind === 'capabilities'
    ) as Array<[Record<string, unknown>, string]>;
  }
  function readyPosts(
    spy: ReturnType<typeof vi.fn>
  ): Array<[Record<string, unknown>, string]> {
    return spy.mock.calls.filter(
      (c) => isSignal(c[0]) && (c[0] as { kind?: unknown }).kind === 'ready'
    ) as Array<[Record<string, unknown>, string]>;
  }

  function hello(iframe: HTMLIFrameElement, origin = WIDGET, source?: Window | null): void {
    dispatchMessage({
      data: { ns: WALLET_SIGNAL_NS, kind: 'hello' },
      origin,
      source: source === undefined ? iframe.contentWindow : source,
    });
  }
  function connectRequest(
    iframe: HTMLIFrameElement,
    channel: 'cosmos' | 'evm',
    origin = WIDGET,
    source?: Window | null
  ): void {
    dispatchMessage({
      data: { ns: WALLET_SIGNAL_NS, kind: 'connect-request', channel },
      origin,
      source: source === undefined ? iframe.contentWindow : source,
    });
  }

  it('hello -> capabilities with BOTH channels true when onWalletConnectRequest is provided', () => {
    const { iframe, win } = makeIframe();
    const onWalletConnectRequest = vi.fn();
    const ctrl = createWalletBridge({ iframe, widgetOrigin: WIDGET, onWalletConnectRequest });
    win.postMessage.mockClear();

    hello(iframe);

    const caps = capabilitiesPosts(win.postMessage);
    expect(caps).toHaveLength(1);
    const [msg, targetOrigin] = caps[0] as [Record<string, unknown>, string];
    expect(msg).toEqual({
      ns: WALLET_SIGNAL_NS,
      kind: 'capabilities',
      canRequestConnect: { cosmos: true, evm: true },
    });
    // Reply targets the iframe origin, never '*'.
    expect(targetOrigin).toBe(WIDGET);
    ctrl.teardown();
  });

  it('hello -> capabilities with BOTH channels false when no onWalletConnectRequest', () => {
    const { iframe, win } = makeIframe();
    const ctrl = createWalletBridge({ iframe, widgetOrigin: WIDGET });
    win.postMessage.mockClear();

    hello(iframe);

    const caps = capabilitiesPosts(win.postMessage);
    expect(caps).toHaveLength(1);
    expect(caps[0]?.[0]).toEqual({
      ns: WALLET_SIGNAL_NS,
      kind: 'capabilities',
      canRequestConnect: { cosmos: false, evm: false },
    });
    // No connectPrompt key when not configured.
    expect('connectPrompt' in (caps[0]?.[0] as object)).toBe(false);
    ctrl.teardown();
  });

  it('hello -> capabilities forwards connectPrompt when set, omits it when not', () => {
    // With connectPrompt.
    {
      const { iframe, win } = makeIframe();
      const ctrl = createWalletBridge({
        iframe,
        widgetOrigin: WIDGET,
        connectPrompt: 'Connect your wallet on HighStakes',
      });
      win.postMessage.mockClear();
      hello(iframe);
      const caps = capabilitiesPosts(win.postMessage);
      expect(caps[0]?.[0]).toEqual({
        ns: WALLET_SIGNAL_NS,
        kind: 'capabilities',
        canRequestConnect: { cosmos: false, evm: false },
        connectPrompt: 'Connect your wallet on HighStakes',
      });
      ctrl.teardown();
    }
    // Without connectPrompt: the key is omitted entirely (not undefined).
    {
      const { iframe, win } = makeIframe();
      const ctrl = createWalletBridge({ iframe, widgetOrigin: WIDGET });
      win.postMessage.mockClear();
      hello(iframe);
      const caps = capabilitiesPosts(win.postMessage);
      expect('connectPrompt' in (caps[0]?.[0] as object)).toBe(false);
      ctrl.teardown();
    }
  });

  it('hello re-posts ready for a channel ALREADY wired at hello time (late-listener race)', () => {
    const { iframe, win } = makeIframe();
    const ctrl = createWalletBridge({ iframe, widgetOrigin: WIDGET });
    // Integrator connected BEFORE the iframe attached its control listener.
    ctrl.setWallet({ cosmos: cosmosHandle() });
    win.postMessage.mockClear();

    // The iframe finally says hello.
    hello(iframe);

    // It gets capabilities AND a re-posted ready for the already-wired channel.
    const caps = capabilitiesPosts(win.postMessage);
    expect(caps).toHaveLength(1);
    const ready = readyPosts(win.postMessage);
    expect(ready).toHaveLength(1);
    expect(ready[0]?.[0]).toEqual({
      ns: WALLET_SIGNAL_NS,
      kind: 'ready',
      channels: ['cosmos'],
    });
    expect(ready[0]?.[1]).toBe(WIDGET);
    ctrl.teardown();
  });

  it('hello re-posts ready listing BOTH channels when both are already wired', () => {
    const { iframe, win } = makeIframe();
    const ctrl = createWalletBridge({ iframe, widgetOrigin: WIDGET });
    ctrl.setWallet({ cosmos: cosmosHandle(), evm: evmHandle() });
    win.postMessage.mockClear();

    hello(iframe);

    const ready = readyPosts(win.postMessage);
    expect(ready).toHaveLength(1);
    const msg = ready[0]?.[0] as { channels: string[] };
    expect(msg.channels).toEqual(expect.arrayContaining(['cosmos', 'evm']));
    ctrl.teardown();
  });

  it('hello does NOT post ready when no channel is wired yet (only capabilities)', () => {
    const { iframe, win } = makeIframe();
    const ctrl = createWalletBridge({ iframe, widgetOrigin: WIDGET });
    win.postMessage.mockClear();

    hello(iframe);

    expect(capabilitiesPosts(win.postMessage)).toHaveLength(1);
    expect(readyPosts(win.postMessage)).toHaveLength(0);
    ctrl.teardown();
  });

  it('connect-request{channel} invokes onWalletConnectRequest with that exact channel', () => {
    const { iframe } = makeIframe();
    const onWalletConnectRequest = vi.fn();
    const ctrl = createWalletBridge({ iframe, widgetOrigin: WIDGET, onWalletConnectRequest });

    connectRequest(iframe, 'cosmos');
    expect(onWalletConnectRequest).toHaveBeenCalledTimes(1);
    expect(onWalletConnectRequest).toHaveBeenLastCalledWith('cosmos');

    connectRequest(iframe, 'evm');
    expect(onWalletConnectRequest).toHaveBeenCalledTimes(2);
    expect(onWalletConnectRequest).toHaveBeenLastCalledWith('evm');
    ctrl.teardown();
  });

  it('connect-request with NO registered handler does not throw', () => {
    const { iframe } = makeIframe();
    const ctrl = createWalletBridge({ iframe, widgetOrigin: WIDGET });
    expect(() => connectRequest(iframe, 'cosmos')).not.toThrow();
    ctrl.teardown();
  });

  it('a throwing onWalletConnectRequest is swallowed (warned, never bubbles)', () => {
    const { iframe } = makeIframe();
    const warn = vi.fn();
    const onWalletConnectRequest = vi.fn(() => {
      throw new Error('integrator connect flow blew up');
    });
    const ctrl = createWalletBridge({
      iframe,
      widgetOrigin: WIDGET,
      onWalletConnectRequest,
      warn,
    });
    expect(() => connectRequest(iframe, 'evm')).not.toThrow();
    expect(onWalletConnectRequest).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toContain('evm');
    ctrl.teardown();
  });

  /* ----------------------------- adversarial ---------------------------- */

  it('IGNORES hello from the WRONG ORIGIN (no capabilities reply)', () => {
    const { iframe, win } = makeIframe();
    const onWalletConnectRequest = vi.fn();
    const ctrl = createWalletBridge({ iframe, widgetOrigin: WIDGET, onWalletConnectRequest });
    win.postMessage.mockClear();

    hello(iframe, 'https://attacker.example', iframe.contentWindow);

    expect(capabilitiesPosts(win.postMessage)).toHaveLength(0);
    ctrl.teardown();
  });

  it('IGNORES hello from the WRONG SOURCE window (no capabilities reply)', () => {
    const { iframe, win } = makeIframe();
    const ctrl = createWalletBridge({ iframe, widgetOrigin: WIDGET });
    win.postMessage.mockClear();
    const otherWindow = { postMessage: vi.fn() } as unknown as Window;

    hello(iframe, WIDGET, otherWindow);

    expect(capabilitiesPosts(win.postMessage)).toHaveLength(0);
    ctrl.teardown();
  });

  it('IGNORES connect-request from the WRONG ORIGIN (handler not fired)', () => {
    const { iframe } = makeIframe();
    const onWalletConnectRequest = vi.fn();
    const ctrl = createWalletBridge({ iframe, widgetOrigin: WIDGET, onWalletConnectRequest });

    connectRequest(iframe, 'cosmos', 'https://attacker.example', iframe.contentWindow);

    expect(onWalletConnectRequest).not.toHaveBeenCalled();
    ctrl.teardown();
  });

  it('IGNORES connect-request from the WRONG SOURCE window (handler not fired)', () => {
    const { iframe } = makeIframe();
    const onWalletConnectRequest = vi.fn();
    const ctrl = createWalletBridge({ iframe, widgetOrigin: WIDGET, onWalletConnectRequest });
    const otherWindow = { postMessage: vi.fn() } as unknown as Window;

    connectRequest(iframe, 'evm', WIDGET, otherWindow);

    expect(onWalletConnectRequest).not.toHaveBeenCalled();
    ctrl.teardown();
  });

  it('the control listener is removed on teardown (post-teardown hello / connect-request are inert)', () => {
    const { iframe, win } = makeIframe();
    const onWalletConnectRequest = vi.fn();
    const ctrl = createWalletBridge({ iframe, widgetOrigin: WIDGET, onWalletConnectRequest });
    ctrl.teardown();
    win.postMessage.mockClear();

    hello(iframe);
    connectRequest(iframe, 'cosmos');

    expect(capabilitiesPosts(win.postMessage)).toHaveLength(0);
    expect(onWalletConnectRequest).not.toHaveBeenCalled();
  });
});
