/**
 * Parent-side cosmos handshake tests, run against the REAL @dao-dao/cosmiframe
 * (NOT mocked). The mocked wallet-bridge.test.ts pins the params we hand
 * cosmiframe; this file exercises the live listener end to end so the contract
 * that actually matters at runtime is covered: the embedded widget's mount-time
 * `isReady()` probe (an `isCosmiframe` call with a 500ms window) is answered by
 * the parent the instant the controller is created, with NO wallet connected.
 *
 * The bug this guards: cosmos-kit, on iframe mount, auto-reconnects the
 * cosmiframe wallet and runs `isReady()`. If the parent has not installed
 * `Cosmiframe.listen` yet (the old design wired it only inside the cosmos path
 * of setWallet), the probe times out and cosmos-kit throws "Failed to detect
 * Cosmiframe parent of allowed origin", so parent-wallet adoption never happens.
 *
 * cosmiframe's parent listener (client.js `listen`) accepts an inbound message
 * only when `event.source === iframe.contentWindow` AND the origin is allowed,
 * then posts the result back to `iframe.contentWindow.postMessage(..., origin)`.
 * We drive a real inbound MessageEvent with those exact fields and read the
 * response off the contentWindow postMessage spy - a genuine round trip through
 * the unmocked library.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { createWalletBridge } from '../src/wallet-bridge.js';

const WIDGET = 'https://atomcircuit.net';

/** Drain microtasks so cosmiframe's async listener settles and posts back. */
async function flush(): Promise<void> {
  for (let i = 0; i < 8; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await Promise.resolve();
  }
}

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

/**
 * Dispatch a real inbound cosmiframe request to the parent listener. `internal`
 * is set for the handshake methods (isCosmiframe / getMetadata); a target method
 * call omits it. `source` defaults to the iframe's contentWindow (the only
 * source the listener accepts) and `origin` to the widget origin.
 */
function callParent(opts: {
  iframe: HTMLIFrameElement;
  id: string;
  method: string;
  params?: unknown[];
  internal?: boolean;
  origin?: string;
  source?: Window | null;
}): void {
  const data: Record<string, unknown> = {
    id: opts.id,
    method: opts.method,
    params: opts.params ?? [],
  };
  if (opts.internal) data['internal'] = true;
  const event = new MessageEvent('message', {
    data,
    origin: opts.origin ?? WIDGET,
  });
  Object.defineProperty(event, 'source', {
    configurable: true,
    get: () =>
      opts.source === undefined ? opts.iframe.contentWindow : opts.source,
  });
  window.dispatchEvent(event);
}

/** The cosmiframe responses posted to the iframe (id-tagged success/error). */
function responsesFor(
  win: FakeWindow,
  id: string
): Array<Record<string, unknown>> {
  return win.postMessage.mock.calls
    .map((c) => c[0] as Record<string, unknown>)
    .filter((m) => m && m['id'] === id);
}

function cosmosHandle(target: Record<string, unknown> = {}) {
  return {
    target,
    getOfflineSignerDirect: vi.fn(),
    getOfflineSignerAmino: vi.fn(),
    metadata: { name: 'HighStakes', imageUrl: 'https://hs.example/logo.png' },
  };
}

describe('cosmos handshake against the real cosmiframe (no mock)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('answers the isCosmiframe probe with success:true at controller creation, NO wallet connected', async () => {
    const { iframe, win } = makeIframe();
    // Controller created in parent mode. No setWallet, no handle.
    const ctrl = createWalletBridge({ iframe, widgetOrigin: WIDGET });

    callParent({ iframe, id: 'probe-1', method: 'isCosmiframe', internal: true });
    await flush();

    const res = responsesFor(win, 'probe-1');
    expect(res).toHaveLength(1);
    expect(res[0]).toEqual({ type: 'success', response: true, id: 'probe-1' });
    // Posted back to the widget origin, never '*'.
    const targetOrigin = win.postMessage.mock.calls.find(
      (c) => (c[0] as { id?: string }).id === 'probe-1'
    )?.[1];
    expect(targetOrigin).toBe(WIDGET);
    ctrl.teardown();
  });

  it('answers getMetadata with null before a handle is set, and with the handle metadata after setWallet', async () => {
    const { iframe, win } = makeIframe();
    const ctrl = createWalletBridge({ iframe, widgetOrigin: WIDGET });

    // Before any wallet: empty metadata object (cosmiframe answers `metadata ||
    // null`; the stable view object starts empty so the child sees {}).
    callParent({ iframe, id: 'md-empty', method: 'getMetadata', internal: true });
    await flush();
    const empty = responsesFor(win, 'md-empty');
    expect(empty).toHaveLength(1);
    expect(empty[0]).toEqual({ type: 'success', response: {}, id: 'md-empty' });

    // After setWallet the same listener surfaces the handle's metadata.
    ctrl.setWallet({ cosmos: cosmosHandle() });
    callParent({ iframe, id: 'md-set', method: 'getMetadata', internal: true });
    await flush();
    const set = responsesFor(win, 'md-set');
    expect(set).toHaveLength(1);
    expect(set[0]).toEqual({
      type: 'success',
      response: { name: 'HighStakes', imageUrl: 'https://hs.example/logo.png' },
      id: 'md-set',
    });

    // clearWallet leaves the listener installed and reverts metadata to empty.
    ctrl.clearWallet(['cosmos']);
    callParent({ iframe, id: 'md-clear', method: 'getMetadata', internal: true });
    await flush();
    const cleared = responsesFor(win, 'md-clear');
    expect(cleared).toHaveLength(1);
    expect(cleared[0]).toEqual({ type: 'success', response: {}, id: 'md-clear' });

    ctrl.teardown();
  });

  it('a proxied cosmos method call BEFORE setWallet rejects cleanly with the no-handle message (error response, not a crash)', async () => {
    const { iframe, win } = makeIframe();
    // Controller created in parent mode. No setWallet, no handle.
    const ctrl = createWalletBridge({ iframe, widgetOrigin: WIDGET });

    // getKey is a normal (non-internal) target method. With no handle the
    // dispatcher rejects immediately, and cosmiframe relays the throw to the
    // child as a structured `{ type: 'error' }` response carrying the message.
    callParent({ iframe, id: 'no-handle', method: 'getKey', params: ['cosmoshub-4'] });
    await flush();

    const res = responsesFor(win, 'no-handle');
    expect(res).toHaveLength(1);
    expect(res[0]?.['type']).toBe('error');
    expect(String(res[0]?.['error'])).toContain(
      'No parent Cosmos wallet is connected'
    );

    // The listener survived: the handshake still answers after the rejection.
    callParent({ iframe, id: 'probe-after', method: 'isCosmiframe', internal: true });
    await flush();
    expect(responsesFor(win, 'probe-after')[0]).toEqual({
      type: 'success',
      response: true,
      id: 'probe-after',
    });
    ctrl.teardown();
  });

  it('proxies a target method to the held wallet after setWallet (real dispatch), and to the NEW wallet after a re-set', async () => {
    const { iframe, win } = makeIframe();
    const ctrl = createWalletBridge({ iframe, widgetOrigin: WIDGET });

    const getKeyA = vi.fn().mockResolvedValue({ name: 'A', bech32Address: 'cosmos1aaa' });
    ctrl.setWallet({ cosmos: cosmosHandle({ getKey: getKeyA }) });

    callParent({ iframe, id: 'gk-1', method: 'getKey', params: ['cosmoshub-4'] });
    await flush();
    expect(getKeyA).toHaveBeenCalledWith('cosmoshub-4');
    expect(responsesFor(win, 'gk-1')[0]).toEqual({
      type: 'success',
      response: { name: 'A', bech32Address: 'cosmos1aaa' },
      id: 'gk-1',
    });

    // Account switch: re-set with a fresh handle. The SAME listener now
    // dispatches to the new wallet's getKey (handle swapped behind the proxy).
    const getKeyB = vi.fn().mockResolvedValue({ name: 'B', bech32Address: 'cosmos1bbb' });
    ctrl.setWallet({ cosmos: cosmosHandle({ getKey: getKeyB }) });

    callParent({ iframe, id: 'gk-2', method: 'getKey', params: ['cosmoshub-4'] });
    await flush();
    expect(getKeyB).toHaveBeenCalledWith('cosmoshub-4');
    // The old wallet is NOT called again.
    expect(getKeyA).toHaveBeenCalledTimes(1);
    expect(responsesFor(win, 'gk-2')[0]).toEqual({
      type: 'success',
      response: { name: 'B', bech32Address: 'cosmos1bbb' },
      id: 'gk-2',
    });
    ctrl.teardown();
  });

  it('a target method ABSENT on the connected wallet rejects cleanly (error response, not a crash)', async () => {
    const { iframe, win } = makeIframe();
    const ctrl = createWalletBridge({ iframe, widgetOrigin: WIDGET });
    // Wallet has getKey but not the requested method.
    ctrl.setWallet({ cosmos: cosmosHandle({ getKey: vi.fn() }) });

    callParent({ iframe, id: 'missing', method: 'someMethodTheWalletLacks', params: [] });
    await flush();

    const res = responsesFor(win, 'missing');
    expect(res).toHaveLength(1);
    expect(res[0]?.['type']).toBe('error');
    expect(String(res[0]?.['error'])).toContain('someMethodTheWalletLacks');
    ctrl.teardown();
  });

  it('IGNORES a probe from the WRONG ORIGIN (no response) - origin pinning preserved', async () => {
    const { iframe, win } = makeIframe();
    const ctrl = createWalletBridge({ iframe, widgetOrigin: WIDGET });

    callParent({
      iframe,
      id: 'evil-origin',
      method: 'isCosmiframe',
      internal: true,
      origin: 'https://attacker.example',
    });
    await flush();
    expect(responsesFor(win, 'evil-origin')).toHaveLength(0);
    ctrl.teardown();
  });

  it('IGNORES a probe from the WRONG SOURCE window (no response) - source pinning preserved', async () => {
    const { iframe, win } = makeIframe();
    const ctrl = createWalletBridge({ iframe, widgetOrigin: WIDGET });

    callParent({
      iframe,
      id: 'evil-source',
      method: 'isCosmiframe',
      internal: true,
      source: { postMessage: vi.fn() } as unknown as Window,
    });
    await flush();
    expect(responsesFor(win, 'evil-source')).toHaveLength(0);
    ctrl.teardown();
  });

  it('after teardown the cosmiframe listener is removed: a probe gets no response', async () => {
    const { iframe, win } = makeIframe();
    const ctrl = createWalletBridge({ iframe, widgetOrigin: WIDGET });
    ctrl.teardown();

    callParent({ iframe, id: 'post-teardown', method: 'isCosmiframe', internal: true });
    await flush();
    expect(responsesFor(win, 'post-teardown')).toHaveLength(0);
  });
});
