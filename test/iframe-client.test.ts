import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { IframeClient } from '../src/iframe-client.js';
import { PROTOCOL_VERSION, WIDGET_ORIGIN } from '../src/protocol.js';

/**
 * Build a fake iframe element whose `contentWindow` is a fresh JSDOM iframe
 * window. We do not exercise the real Penpal handshake here; instead we
 * exercise the raw postMessage stream pathway and the origin guard. The
 * Playwright suite covers the full Penpal handshake end-to-end.
 */
function setupFakeIframe(): { iframe: HTMLIFrameElement; remoteWindow: Window } {
  const iframe = document.createElement('iframe');
  // Give the iframe a src so JSDOM attaches a contentWindow.
  iframe.src = 'about:blank';
  document.body.appendChild(iframe);
  const remoteWindow = iframe.contentWindow as Window;
  return { iframe, remoteWindow };
}

function dispatchMessage(client: IframeClient, opts: {
  origin: string;
  data: unknown;
  source: Window | null;
}): void {
  // We use the test seam rather than dispatching via window.dispatchEvent so
  // we can control `event.source` (JSDOM does not let us set it on a synthetic
  // MessageEvent).
  const event = {
    origin: opts.origin,
    data: opts.data,
    source: opts.source,
  } as unknown as MessageEvent;
  client._handleMessageForTest(event);
}

describe('IframeClient (raw postMessage path)', () => {
  let iframe: HTMLIFrameElement;
  let remoteWindow: Window;
  let client: IframeClient;

  beforeEach(() => {
    const setup = setupFakeIframe();
    iframe = setup.iframe;
    remoteWindow = setup.remoteWindow;
    client = new IframeClient({ iframe });
  });

  afterEach(() => {
    client.destroy();
    iframe.remove();
  });

  it('records a handshake delivered as a raw postMessage', () => {
    const handler = vi.fn();
    client.on('ready', handler);

    dispatchMessage(client, {
      origin: WIDGET_ORIGIN,
      source: remoteWindow,
      data: {
        type: 'handshake',
        protocolVersion: PROTOCOL_VERSION,
        capabilities: ['swap.submit'],
      },
    });

    const handshake = client.getHandshake();
    expect(handshake).not.toBeNull();
    expect(handshake?.protocolVersion).toBe(PROTOCOL_VERSION);
    expect(handshake?.capabilities).toEqual(['swap.submit']);
  });

  it('ignores trusted-origin messages whose data is a plain string', () => {
    const handler = vi.fn();
    client.on('ready', handler);
    client.on('resize', handler);
    client.on('swap:submitted', handler);
    client.on('swap:success', handler);
    client.on('swap:error', handler);

    dispatchMessage(client, {
      origin: WIDGET_ORIGIN,
      source: remoteWindow,
      data: 'hello',
    });

    expect(handler).not.toHaveBeenCalled();
    expect(client.getHandshake()).toBeNull();
  });

  it('ignores trusted-origin messages with an unknown type tag', () => {
    const handler = vi.fn();
    client.on('ready', handler);
    client.on('resize', handler);
    client.on('swap:submitted', handler);
    client.on('swap:success', handler);
    client.on('swap:error', handler);

    dispatchMessage(client, {
      origin: WIDGET_ORIGIN,
      source: remoteWindow,
      data: { type: 'unknown' },
    });

    expect(handler).not.toHaveBeenCalled();
    expect(client.getHandshake()).toBeNull();
  });

  it('rejects messages from a non-trusted origin', () => {
    const handler = vi.fn();
    client.on('resize', handler);

    dispatchMessage(client, {
      origin: 'https://attacker.example',
      source: remoteWindow,
      data: { type: 'atomcircuit:resize', height: 999 },
    });

    expect(handler).not.toHaveBeenCalled();
    expect(client.getHandshake()).toBeNull();
  });

  it('rejects messages from the trusted origin but wrong source window', () => {
    const handler = vi.fn();
    client.on('resize', handler);

    // Another iframe on the same origin but a different window object.
    const other = document.createElement('iframe');
    other.src = 'about:blank';
    document.body.appendChild(other);

    dispatchMessage(client, {
      origin: WIDGET_ORIGIN,
      source: other.contentWindow,
      data: { type: 'atomcircuit:resize', height: 700 },
    });

    expect(handler).not.toHaveBeenCalled();
    other.remove();
  });

  it('routes resize events to subscribers', () => {
    const handler = vi.fn();
    client.on('resize', handler);

    dispatchMessage(client, {
      origin: WIDGET_ORIGIN,
      source: remoteWindow,
      data: { type: 'atomcircuit:resize', height: 612 },
    });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith({ height: 612 });
  });

  it('routes typed widget events to the matching subscriber', () => {
    const onSubmitted = vi.fn();
    const onSuccess = vi.fn();
    const onError = vi.fn();
    client.on('swap:submitted', onSubmitted);
    client.on('swap:success', onSuccess);
    client.on('swap:error', onError);

    dispatchMessage(client, {
      origin: WIDGET_ORIGIN,
      source: remoteWindow,
      data: {
        type: 'atomcircuit:event',
        name: 'swap:submitted',
        payload: { txHash: '0xabc' },
      },
    });
    dispatchMessage(client, {
      origin: WIDGET_ORIGIN,
      source: remoteWindow,
      data: {
        type: 'atomcircuit:event',
        name: 'swap:success',
        payload: { txHash: '0xabc' },
      },
    });
    dispatchMessage(client, {
      origin: WIDGET_ORIGIN,
      source: remoteWindow,
      data: {
        type: 'atomcircuit:event',
        name: 'swap:error',
        payload: { code: 'USER_REJECTED', message: 'rejected' },
      },
    });

    expect(onSubmitted).toHaveBeenCalledWith({ txHash: '0xabc' });
    expect(onSuccess).toHaveBeenCalledWith({ txHash: '0xabc' });
    expect(onError).toHaveBeenCalledWith({ code: 'USER_REJECTED', message: 'rejected' });
  });

  it('off() removes a registered handler', () => {
    const handler = vi.fn();
    client.on('resize', handler);
    client.off('resize', handler);

    dispatchMessage(client, {
      origin: WIDGET_ORIGIN,
      source: remoteWindow,
      data: { type: 'atomcircuit:resize', height: 100 },
    });

    expect(handler).not.toHaveBeenCalled();
  });

  it('on() returns an unsubscribe function', () => {
    const handler = vi.fn();
    const unsub = client.on('resize', handler);
    unsub();

    dispatchMessage(client, {
      origin: WIDGET_ORIGIN,
      source: remoteWindow,
      data: { type: 'atomcircuit:resize', height: 100 },
    });

    expect(handler).not.toHaveBeenCalled();
  });

  it('destroy() clears all subscribers and is idempotent', () => {
    const handler = vi.fn();
    client.on('resize', handler);

    client.destroy();
    client.destroy();

    dispatchMessage(client, {
      origin: WIDGET_ORIGIN,
      source: remoteWindow,
      data: { type: 'atomcircuit:resize', height: 100 },
    });

    expect(handler).not.toHaveBeenCalled();
  });

  it('warns when the remote protocol version is incompatible', () => {
    const warn = vi.fn();
    const otherClient = new IframeClient({ iframe, warn });
    dispatchMessage(otherClient, {
      origin: WIDGET_ORIGIN,
      source: remoteWindow,
      data: {
        type: 'handshake',
        protocolVersion: '2.0.0',
        capabilities: [],
      },
    });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toContain('protocol mismatch');
    otherClient.destroy();
  });

  it('does NOT warn on matching majors', () => {
    const warn = vi.fn();
    const otherClient = new IframeClient({ iframe, warn });
    dispatchMessage(otherClient, {
      origin: WIDGET_ORIGIN,
      source: remoteWindow,
      data: {
        type: 'handshake',
        protocolVersion: '1.7.4',
        capabilities: [],
      },
    });
    expect(warn).not.toHaveBeenCalled();
    otherClient.destroy();
  });

  describe('has() capability gating', () => {
    it('returns false before any handshake has been observed', () => {
      expect(client.has('quote')).toBe(false);
      expect(client.has('anything')).toBe(false);
    });

    it('returns true for advertised capabilities after handshake', () => {
      dispatchMessage(client, {
        origin: WIDGET_ORIGIN,
        source: remoteWindow,
        data: {
          type: 'handshake',
          protocolVersion: PROTOCOL_VERSION,
          capabilities: ['quote', 'route'],
        },
      });

      expect(client.has('quote')).toBe(true);
      expect(client.has('route')).toBe(true);
    });

    it('returns false for capabilities the iframe did not advertise', () => {
      dispatchMessage(client, {
        origin: WIDGET_ORIGIN,
        source: remoteWindow,
        data: {
          type: 'handshake',
          protocolVersion: PROTOCOL_VERSION,
          capabilities: ['quote', 'route'],
        },
      });

      expect(client.has('unknown')).toBe(false);
      expect(client.has('swap.submit')).toBe(false);
    });

    it('returns false when capabilities array is empty', () => {
      dispatchMessage(client, {
        origin: WIDGET_ORIGIN,
        source: remoteWindow,
        data: {
          type: 'handshake',
          protocolVersion: PROTOCOL_VERSION,
          capabilities: [],
        },
      });

      expect(client.has('quote')).toBe(false);
    });
  });
});
