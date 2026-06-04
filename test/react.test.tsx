/**
 * React wrapper lifecycle tests.
 *
 * The vanilla mount path is covered in mount.test.ts; this file pins the
 * extra contracts the React wrapper layers on top: mount-once semantics,
 * StrictMode double-effect safety, the callback-ref pattern that avoids
 * re-mounts on stale closures, key-bump force-remount, and SSR safety
 * (renders nothing before hydration).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { StrictMode } from 'react';
import { render, cleanup, act } from '@testing-library/react';

// Mock cosmiframe BEFORE importing the wrapper so the cosmos bridge wiring is
// observable (Cosmiframe.listen is the spy) without touching cosmiframe
// internals.
const listenSpy = vi.fn<(opts: unknown) => () => void>();
vi.mock('@dao-dao/cosmiframe', () => ({
  Cosmiframe: {
    listen: (opts: unknown): (() => void) => listenSpy(opts),
  },
}));

import { AtomCircuitSwap } from '../src/react.js';
import { IframeClient } from '../src/iframe-client.js';
import { WALLET_SIGNAL_NS } from '../src/protocol.js';
import type { WalletCosmosHandle } from '../src/protocol.js';

describe('<AtomCircuitSwap />', () => {
  beforeEach(() => {
    // Stop the Penpal handshake from finishing in jsdom so iframes stay
    // attached and we can assert the DOM shape.
    vi.spyOn(IframeClient.prototype, 'init').mockImplementation(
      () =>
        new Promise(() => {
          /* never resolves */
        })
    );
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('mounts an iframe on first render', () => {
    const { container } = render(
      <AtomCircuitSwap referralId="val1" />
    );
    const iframes = container.querySelectorAll('iframe');
    expect(iframes.length).toBe(1);
  });

  it('forwards allowReferralChoice into the iframe theme blob', () => {
    const { container } = render(
      <AtomCircuitSwap referralId="val1" allowReferralChoice />
    );
    const iframe = container.querySelector('iframe');
    expect(iframe).not.toBeNull();
    const url = new URL((iframe as HTMLIFrameElement).src);
    expect(url.searchParams.get('ref')).toBe('val1');
    const param = url.searchParams.get('theme');
    expect(param).not.toBeNull();
    const json =
      typeof atob === 'function'
        ? atob(param as string)
        : Buffer.from(param as string, 'base64').toString('utf-8');
    expect(JSON.parse(json)).toEqual({ allowReferralChoice: true });
  });

  it('omits the theme blob when allowReferralChoice is absent (backwards-compat)', () => {
    const { container } = render(<AtomCircuitSwap referralId="val1" />);
    const iframe = container.querySelector('iframe');
    const url = new URL((iframe as HTMLIFrameElement).src);
    expect(url.searchParams.has('theme')).toBe(false);
  });

  it('StrictMode double-effect produces exactly one persisted iframe', () => {
    // React 18 StrictMode in dev runs effects twice (mount, cleanup, mount).
    // The wrapper must destroy the first instance during cleanup so the
    // tree settles on a single iframe, not two.
    const { container } = render(
      <StrictMode>
        <AtomCircuitSwap referralId="val1" />
      </StrictMode>
    );
    const iframes = container.querySelectorAll('iframe');
    expect(iframes.length).toBe(1);
  });

  it('does NOT re-mount the iframe when only a callback prop changes', () => {
    const cb1 = vi.fn();
    const cb2 = vi.fn();
    const { container, rerender } = render(
      <AtomCircuitSwap referralId="val1" onSwapSuccess={cb1} />
    );
    const firstIframe = container.querySelector('iframe');
    expect(firstIframe).not.toBeNull();

    rerender(<AtomCircuitSwap referralId="val1" onSwapSuccess={cb2} />);
    const secondIframe = container.querySelector('iframe');
    expect(secondIframe).toBe(firstIframe);
  });

  it('does NOT re-mount when theme prop changes', () => {
    const { container, rerender } = render(
      <AtomCircuitSwap
        referralId="val1"
        theme={{ mode: 'dark', accentColor: '#abc' }}
      />
    );
    const firstIframe = container.querySelector('iframe');
    rerender(
      <AtomCircuitSwap
        referralId="val1"
        theme={{ mode: 'light', accentColor: '#def' }}
      />
    );
    const secondIframe = container.querySelector('iframe');
    expect(secondIframe).toBe(firstIframe);
  });

  it('re-mounts when key= changes (force-remount pattern)', () => {
    const { container, rerender } = render(
      <AtomCircuitSwap key={0} referralId="val1" />
    );
    const firstIframe = container.querySelector('iframe');
    expect(firstIframe).not.toBeNull();

    rerender(<AtomCircuitSwap key={1} referralId="val1" />);
    const secondIframe = container.querySelector('iframe');
    expect(secondIframe).not.toBeNull();
    expect(secondIframe).not.toBe(firstIframe);
  });

  it('re-mounts when referralId changes', () => {
    const { container, rerender } = render(
      <AtomCircuitSwap referralId="val1" />
    );
    const firstIframe = container.querySelector('iframe');
    expect(firstIframe?.getAttribute('src')).toContain('ref=val1');

    rerender(<AtomCircuitSwap referralId="val2" />);
    const secondIframe = container.querySelector('iframe');
    expect(secondIframe).not.toBe(firstIframe);
    expect(secondIframe?.getAttribute('src')).toContain('ref=val2');
  });

  it('returns a real outer DOM node (SSR-safe, not null)', () => {
    // The component returns a real <div> outer container synchronously; the
    // iframe is only created inside the effect. Confirm the outer node exists
    // by reading the rendered container's first child rather than relying on
    // any data attribute (the outer container deliberately carries none).
    const { container } = render(<AtomCircuitSwap referralId="val1" />);
    const outer = container.firstElementChild;
    expect(outer).not.toBeNull();
    expect(outer?.tagName).toBe('DIV');
  });

  it('marks exactly one element with data-atom-circuit-embed (the SDK wrapper, not the React outer container)', () => {
    // Regression for the React double-attribute bug: the SDK-managed wrapper
    // created by mount() carries data-atom-circuit-embed; the React outer
    // container must NOT, so the documented `[data-atom-circuit-embed] iframe`
    // selector matches exactly one path (not two nested elements).
    const { container } = render(<AtomCircuitSwap referralId="val1" />);
    const tagged = container.querySelectorAll('[data-atom-circuit-embed]');
    expect(tagged.length).toBe(1);
    // The single tagged element is the SDK wrapper that holds the iframe.
    expect(tagged[0]?.querySelector('iframe')).not.toBeNull();
    // The outer React container is a different (parent) element with no attr.
    const outer = container.firstElementChild;
    expect(outer).not.toBeNull();
    expect(outer?.hasAttribute('data-atom-circuit-embed')).toBe(false);
    // And the documented selector resolves to exactly one iframe.
    expect(
      container.querySelectorAll('[data-atom-circuit-embed] iframe').length
    ).toBe(1);
  });

  it('filters height and width out of the React style prop (parity with vanilla applyStyle)', () => {
    // Documented contract: height/width in `style` are ignored on BOTH
    // surfaces. The wrapper width must stay WRAPPER_STYLE's 100% (not the
    // caller's 999px) and height must not be applied; other style props pass
    // through.
    const { container } = render(
      <AtomCircuitSwap
        referralId="val1"
        style={{
          width: '999px',
          height: '777px',
          backgroundColor: 'rgb(1, 2, 3)',
        }}
      />
    );
    const outer = container.firstElementChild as HTMLElement;
    expect(outer).not.toBeNull();
    // width override is dropped; the SDK-managed 100% wins.
    expect(outer.style.width).toBe('100%');
    // height is never applied from style.
    expect(outer.style.height).toBe('');
    // unrelated style props still apply.
    expect(outer.style.backgroundColor).toBe('rgb(1, 2, 3)');
  });

  it('destroys the iframe on unmount', () => {
    const { container, unmount } = render(
      <AtomCircuitSwap referralId="val1" />
    );
    expect(container.querySelectorAll('iframe').length).toBe(1);
    act(() => {
      unmount();
    });
    expect(container.querySelectorAll('iframe').length).toBe(0);
  });
});

describe('<AtomCircuitSwap /> - parent wallet late connect (option Y)', () => {
  beforeEach(() => {
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
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  function cosmosHandle(): WalletCosmosHandle {
    return {
      target: { getKey: vi.fn() },
      getOfflineSignerDirect: vi.fn(),
      getOfflineSignerAmino: vi.fn(),
    };
  }

  /**
   * Install a postMessage-recording fake contentWindow on the single mounted
   * iframe, and return a reader for the wallet-signal posts.
   */
  function trackSignals(container: HTMLElement): () => Array<Record<string, unknown>> {
    const iframe = container.querySelector('iframe') as HTMLIFrameElement;
    const win = { postMessage: vi.fn() };
    Object.defineProperty(iframe, 'contentWindow', {
      configurable: true,
      get: () => win as unknown as Window,
    });
    return () =>
      win.postMessage.mock.calls
        .map((c) => c[0] as Record<string, unknown>)
        .filter((m) => m && m['ns'] === WALLET_SIGNAL_NS);
  }

  it('renders the widget immediately with mode parent and no handles (URL carries walletMode=parent&parentOrigin)', () => {
    const { container } = render(
      <AtomCircuitSwap referralId="val1" wallet={{ mode: 'parent' }} />
    );
    const iframe = container.querySelector('iframe') as HTMLIFrameElement;
    const url = new URL(iframe.src);
    expect(url.searchParams.get('walletMode')).toBe('parent');
    expect(url.searchParams.get('parentOrigin')).toBe('http://localhost:3000');
    expect(url.searchParams.has('token')).toBe(false);
    // The cosmiframe listener is installed at mount in parent mode so the parent
    // answers the embed's handshake before any wallet connects.
    expect(listenSpy).toHaveBeenCalledTimes(1);
  });

  it('adopts the wallet when the handle arrives on a later render, WITHOUT a remount', () => {
    const { container, rerender } = render(
      <AtomCircuitSwap referralId="val1" wallet={{ mode: 'parent' }} />
    );
    const iframeBefore = container.querySelector('iframe');
    const readSignals = trackSignals(container);
    // The listener is installed at mount (parent mode), before any handle.
    expect(listenSpy).toHaveBeenCalledTimes(1);

    // The user connects their wallet on the parent page; the integrator passes
    // the handle on the next render.
    const handle = cosmosHandle();
    rerender(
      <AtomCircuitSwap
        referralId="val1"
        wallet={{ mode: 'parent', cosmos: handle }}
      />
    );

    // Same iframe element -> no remount.
    const iframeAfter = container.querySelector('iframe');
    expect(iframeAfter).toBe(iframeBefore);
    // Still a single listener (the handle is swapped behind it, not re-listened)
    // and the cosmos channel is now adopted via a ready signal.
    expect(listenSpy).toHaveBeenCalledTimes(1);
    const signals = readSignals();
    expect(signals).toContainEqual({
      ns: WALLET_SIGNAL_NS,
      kind: 'ready',
      channels: ['cosmos'],
    });
  });

  it('clearing the handle on a later render posts gone (no remount)', () => {
    const handle = cosmosHandle();
    const { container, rerender } = render(
      <AtomCircuitSwap
        referralId="val1"
        wallet={{ mode: 'parent', cosmos: handle }}
      />
    );
    // Bridge wired at mount.
    expect(listenSpy).toHaveBeenCalledTimes(1);
    const iframeBefore = container.querySelector('iframe');
    const readSignals = trackSignals(container);

    // The user disconnects on the parent; integrator drops the handle.
    rerender(
      <AtomCircuitSwap referralId="val1" wallet={{ mode: 'parent' }} />
    );

    expect(container.querySelector('iframe')).toBe(iframeBefore);
    const signals = readSignals();
    expect(signals).toContainEqual({
      ns: WALLET_SIGNAL_NS,
      kind: 'gone',
      channels: ['cosmos'],
    });
  });

  it('does NOT re-push the handle that was already supplied at mount time', () => {
    const handle = cosmosHandle();
    const { rerender } = render(
      <AtomCircuitSwap
        referralId="val1"
        wallet={{ mode: 'parent', cosmos: handle }}
      />
    );
    expect(listenSpy).toHaveBeenCalledTimes(1);
    // Re-render with the SAME handle identity (only a callback changes).
    rerender(
      <AtomCircuitSwap
        referralId="val1"
        wallet={{ mode: 'parent', cosmos: handle }}
        onSwapSuccess={vi.fn()}
      />
    );
    // No additional wiring: the late-connect effect saw no identity change.
    expect(listenSpy).toHaveBeenCalledTimes(1);
  });

  /**
   * Install a postMessage-recording fake contentWindow and a helper to
   * dispatch a control-channel message from the iframe (right origin + source).
   */
  function controlHarness(container: HTMLElement): {
    capsCount: () => number;
    dispatch: (data: unknown) => void;
  } {
    const iframe = container.querySelector('iframe') as HTMLIFrameElement;
    const win = { postMessage: vi.fn() };
    Object.defineProperty(iframe, 'contentWindow', {
      configurable: true,
      get: () => win as unknown as Window,
    });
    return {
      capsCount: () =>
        win.postMessage.mock.calls.filter((c) => {
          const m = c[0] as Record<string, unknown>;
          return m && m['ns'] === WALLET_SIGNAL_NS && m['kind'] === 'capabilities';
        }).length,
      dispatch: (data: unknown) => {
        const event = new MessageEvent('message', {
          data,
          origin: 'https://atomcircuit.net',
        });
        Object.defineProperty(event, 'source', {
          configurable: true,
          get: () => iframe.contentWindow,
        });
        window.dispatchEvent(event);
      },
    };
  }

  it('threads onWalletConnectRequest + connectPrompt; hello -> capabilities both true with the prompt', () => {
    const onWalletConnectRequest = vi.fn();
    const { container } = render(
      <AtomCircuitSwap
        referralId="val1"
        wallet={{ mode: 'parent' }}
        onWalletConnectRequest={onWalletConnectRequest}
        connectPrompt="Connect your parent wallet"
      />
    );
    const { capsCount, dispatch } = controlHarness(container);

    dispatch({ ns: WALLET_SIGNAL_NS, kind: 'hello' });
    expect(capsCount()).toBe(1);

    dispatch({ ns: WALLET_SIGNAL_NS, kind: 'connect-request', channel: 'evm' });
    expect(onWalletConnectRequest).toHaveBeenCalledWith('evm');
  });

  it('invokes the LATEST onWalletConnectRequest after a callback-identity change, with NO remount', () => {
    const first = vi.fn();
    const second = vi.fn();
    const { container, rerender } = render(
      <AtomCircuitSwap
        referralId="val1"
        wallet={{ mode: 'parent' }}
        onWalletConnectRequest={first}
      />
    );
    const iframeBefore = container.querySelector('iframe');
    const { dispatch } = controlHarness(container);

    // Swap the callback identity (no other URL-baked prop changes).
    rerender(
      <AtomCircuitSwap
        referralId="val1"
        wallet={{ mode: 'parent' }}
        onWalletConnectRequest={second}
      />
    );
    // Same iframe element -> no remount.
    expect(container.querySelector('iframe')).toBe(iframeBefore);

    dispatch({ ns: WALLET_SIGNAL_NS, kind: 'connect-request', channel: 'cosmos' });
    // The current (second) callback runs; the stale one does not.
    expect(second).toHaveBeenCalledWith('cosmos');
    expect(first).not.toHaveBeenCalled();
  });

  it('changing the mode remounts (mode bakes into the iframe URL)', () => {
    const { container, rerender } = render(
      <AtomCircuitSwap referralId="val1" wallet={{ mode: 'iframe' }} />
    );
    const first = container.querySelector('iframe');
    // mode 'iframe' is byte-identical to the pre-feature URL: no walletMode param.
    expect(new URL((first as HTMLIFrameElement).src).searchParams.has('walletMode')).toBe(
      false
    );

    rerender(
      <AtomCircuitSwap referralId="val1" wallet={{ mode: 'parent' }} />
    );
    const second = container.querySelector('iframe');
    expect(second).not.toBe(first);
    expect(new URL((second as HTMLIFrameElement).src).searchParams.get('walletMode')).toBe(
      'parent'
    );
    expect(new URL((second as HTMLIFrameElement).src).searchParams.has('token')).toBe(
      false
    );
  });
});
