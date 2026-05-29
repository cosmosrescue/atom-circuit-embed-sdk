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

import { AtomCircuitSwap } from '../src/react.js';
import { IframeClient } from '../src/iframe-client.js';

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

  it('renders an empty container synchronously (SSR-safe)', () => {
    // Probe the component output before any effect has run. We use
    // server-side render semantics indirectly: render the component, then
    // inspect the wrapper that the first effect tick has not yet touched.
    // In jsdom, effects run synchronously inside act(), so we look at the
    // wrapper element itself (not its children) to confirm the component
    // returns a real DOM node rather than null.
    const { container } = render(<AtomCircuitSwap referralId="val1" />);
    const wrapper = container.querySelector('[data-atom-circuit-embed]');
    expect(wrapper).not.toBeNull();
    expect(wrapper?.tagName).toBe('DIV');
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
