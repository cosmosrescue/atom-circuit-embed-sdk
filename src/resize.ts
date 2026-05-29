/**
 * Host-side resize handler. Subscribes to `IframeClient`'s `resize` stream
 * and applies the reported height to the iframe element, RAF-debounced.
 *
 * The iframe is the source of truth for height; the SDK only clamps to
 * `minHeight` to avoid scrollbar thrash on mobile keyboard open.
 */

import type { IframeClient } from './iframe-client.js';

export interface ResizeOptions {
  iframe: HTMLIFrameElement;
  client: IframeClient;
  minHeight?: string;
}

export interface ResizeHandle {
  destroy(): void;
}

const DEFAULT_MIN_HEIGHT = '480px';

/**
 * Parses a CSS length like "480px" or "30rem" into pixels. Falls back to 0
 * when the unit is not recognised.
 */
function parsePixels(value: string): number {
  const trimmed = value.trim();
  const match = trimmed.match(/^([0-9]+(?:\.[0-9]+)?)(px)?$/i);
  if (!match) return 0;
  const numStr = match[1];
  if (numStr === undefined) return 0;
  const num = Number.parseFloat(numStr);
  return Number.isFinite(num) ? num : 0;
}

/**
 * Wires the iframe's height to incoming resize events. Returns a handle whose
 * `destroy()` unsubscribes and cancels any in-flight RAF.
 */
export function attachResize(opts: ResizeOptions): ResizeHandle {
  const { iframe, client } = opts;
  const minHeight = opts.minHeight ?? DEFAULT_MIN_HEIGHT;
  const minPx = parsePixels(minHeight);

  // Apply min-height immediately so the iframe is not 0px before the first
  // resize message lands.
  iframe.style.minHeight = minHeight;
  if (!iframe.style.height) {
    iframe.style.height = minHeight;
  }

  let pending: number | null = null;
  let lastApplied = -1;
  let destroyed = false;

  const apply = (height: number): void => {
    if (destroyed) return;
    const clamped = Math.max(height, minPx);
    if (clamped === lastApplied) return;
    iframe.style.height = `${clamped}px`;
    lastApplied = clamped;
  };

  const schedule = (height: number): void => {
    if (destroyed) return;
    if (pending !== null) {
      cancelAnimationFrame(pending);
    }
    if (typeof window === 'undefined' || typeof window.requestAnimationFrame !== 'function') {
      apply(height);
      return;
    }
    pending = window.requestAnimationFrame(() => {
      pending = null;
      apply(height);
    });
  };

  const unsubscribe = client.on('resize', ({ height }) => {
    schedule(height);
  });

  return {
    destroy(): void {
      if (destroyed) return;
      destroyed = true;
      if (pending !== null && typeof window !== 'undefined' && typeof window.cancelAnimationFrame === 'function') {
        window.cancelAnimationFrame(pending);
      }
      pending = null;
      unsubscribe();
    },
  };
}

export const RESIZE_DEFAULT_MIN_HEIGHT = DEFAULT_MIN_HEIGHT;
