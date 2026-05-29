import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { IframeClient } from '../src/iframe-client.js';
import { attachResize, RESIZE_DEFAULT_MIN_HEIGHT } from '../src/resize.js';
import { WIDGET_ORIGIN } from '../src/protocol.js';

/**
 * Replace requestAnimationFrame with a synchronous shim so we can assert
 * the resize handler applied without waiting for the next frame.
 */
function installSyncRaf(): void {
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback): number => {
    cb(0);
    return 1;
  });
  vi.stubGlobal('cancelAnimationFrame', (_id: number): void => {
    /* no-op for sync shim */
  });
}

function dispatchResize(client: IframeClient, remoteWindow: Window, height: number): void {
  const event = {
    origin: WIDGET_ORIGIN,
    data: { type: 'atomcircuit:resize', height },
    source: remoteWindow,
  } as unknown as MessageEvent;
  client._handleMessageForTest(event);
}

describe('attachResize', () => {
  let iframe: HTMLIFrameElement;
  let remoteWindow: Window;
  let client: IframeClient;

  beforeEach(() => {
    installSyncRaf();
    iframe = document.createElement('iframe');
    iframe.src = 'about:blank';
    document.body.appendChild(iframe);
    remoteWindow = iframe.contentWindow as Window;
    client = new IframeClient({ iframe });
  });

  afterEach(() => {
    client.destroy();
    iframe.remove();
    vi.unstubAllGlobals();
  });

  it('applies the default min-height immediately on attach', () => {
    attachResize({ iframe, client });
    expect(iframe.style.minHeight).toBe(RESIZE_DEFAULT_MIN_HEIGHT);
    expect(iframe.style.height).toBe(RESIZE_DEFAULT_MIN_HEIGHT);
  });

  it('applies a custom min-height when supplied', () => {
    attachResize({ iframe, client, minHeight: '600px' });
    expect(iframe.style.minHeight).toBe('600px');
    expect(iframe.style.height).toBe('600px');
  });

  it('updates the iframe height when a resize event arrives', () => {
    attachResize({ iframe, client });
    dispatchResize(client, remoteWindow, 720);
    expect(iframe.style.height).toBe('720px');
  });

  it('clamps incoming heights to the configured minimum', () => {
    attachResize({ iframe, client, minHeight: '500px' });
    dispatchResize(client, remoteWindow, 200);
    expect(iframe.style.height).toBe('500px');
  });

  it('does not re-apply identical heights', () => {
    attachResize({ iframe, client });
    dispatchResize(client, remoteWindow, 720);
    expect(iframe.style.height).toBe('720px');

    // Sentinel: set a distinct but VALID css length so JSDOM accepts it,
    // then verify the SDK does NOT overwrite when the next event reports
    // the same height it already applied.
    iframe.style.height = '999px';
    dispatchResize(client, remoteWindow, 720);
    expect(iframe.style.height).toBe('999px');
  });

  it('handles successive different heights', () => {
    attachResize({ iframe, client });
    dispatchResize(client, remoteWindow, 600);
    expect(iframe.style.height).toBe('600px');
    dispatchResize(client, remoteWindow, 800);
    expect(iframe.style.height).toBe('800px');
    dispatchResize(client, remoteWindow, 720);
    expect(iframe.style.height).toBe('720px');
  });

  it('destroy() unsubscribes and ignores subsequent events', () => {
    const handle = attachResize({ iframe, client });
    dispatchResize(client, remoteWindow, 700);
    expect(iframe.style.height).toBe('700px');

    handle.destroy();
    // Use a valid CSS length sentinel so JSDOM does not reject the write.
    iframe.style.height = '111px';
    dispatchResize(client, remoteWindow, 1000);
    expect(iframe.style.height).toBe('111px');
  });

  it('destroy() is idempotent', () => {
    const handle = attachResize({ iframe, client });
    handle.destroy();
    expect(() => handle.destroy()).not.toThrow();
  });
});
