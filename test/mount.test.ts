import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { mount, buildIframeSrc } from '../src/mount.js';
import { IframeClient } from '../src/iframe-client.js';
import { encodeTheme } from '../src/theme.js';
import type { ChromeOptions, MountError, MountOptions, ThemeOptions } from '../src/protocol.js';

/**
 * Drains enough microtasks for `Promise.race(...).then().catch()` chains to
 * settle. The mount() path is: race -> then-clear-timer -> chain catch.
 */
async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 8; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await Promise.resolve();
  }
}

/**
 * Mount-level error reporting tests.
 *
 * The IframeClient handshake never completes against `about:blank` in jsdom,
 * and Penpal's first SYN frame fails synchronously because jsdom rejects
 * cross-origin postMessage targets. To isolate the SDK contract under test
 * (timeout -> 'handshake_failed' via onError or warn), we stub
 * `IframeClient.prototype.init` so the `Promise.race` inside `mount()` is
 * decided by the SDK's own 15s timer, not by Penpal's jsdom incompatibility.
 */
describe('mount() error reporting', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    container.remove();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('throws synchronously when container is missing', () => {
    expect(() =>
      mount(null as unknown as HTMLElement, { referralId: 'val1' })
    ).toThrow(/container/);
  });

  it('defaults referralId to "general" when omitted or empty', () => {
    // Three call shapes that should all resolve to the general default:
    // (1) no opts object at all, (2) opts object without referralId,
    // (3) opts with empty string. None of these throw; all of them
    // produce an iframe whose src carries ref=general.
    for (const opts of [undefined, {}, { referralId: '' }, { referralId: '   ' }]) {
      const handle = mount(container, opts as MountOptions | undefined);
      const src = new URL(handle.iframe.src);
      expect(src.searchParams.get('ref')).toBe('general');
      handle.destroy();
    }
  });

  it('uses an explicit referralId verbatim when provided', () => {
    const handle = mount(container, { referralId: 'a70de707' });
    const src = new URL(handle.iframe.src);
    expect(src.searchParams.get('ref')).toBe('a70de707');
    handle.destroy();
  });

  it('fires onError with handshake_failed when the handshake times out', async () => {
    vi.useFakeTimers();
    // Make init() hang forever so the SDK's own 15s race wins.
    vi.spyOn(IframeClient.prototype, 'init').mockImplementation(
      () => new Promise(() => {
        /* never resolves */
      })
    );
    const onError = vi.fn<(e: MountError) => void>();

    const handle = mount(container, {
      referralId: 'val1',
      onError,
    });

    // Advance past the 15s race timeout baked into mount().
    await vi.advanceTimersByTimeAsync(15_001);
    await vi.runAllTimersAsync();

    expect(onError).toHaveBeenCalledTimes(1);
    const arg = onError.mock.calls[0]?.[0];
    expect(arg?.code).toBe('handshake_failed');
    expect(arg?.message).toMatch(/15000ms/);

    handle.destroy();
  });

  it('falls back to console.warn when onError is not supplied', async () => {
    vi.useFakeTimers();
    vi.spyOn(IframeClient.prototype, 'init').mockImplementation(
      () => new Promise(() => {
        /* never resolves */
      })
    );
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {
      /* swallow */
    });

    const handle = mount(container, {
      referralId: 'val1',
    });

    await vi.advanceTimersByTimeAsync(15_001);
    await vi.runAllTimersAsync();

    expect(warnSpy).toHaveBeenCalledTimes(1);
    const msg = warnSpy.mock.calls[0]?.[0];
    expect(String(msg)).toMatch(/Atom Circuit embed/);
    expect(String(msg)).toMatch(/handshake_failed/);

    handle.destroy();
  });

  it('fires onError with the right code when init() rejects with a generic failure', async () => {
    vi.spyOn(IframeClient.prototype, 'init').mockRejectedValue(
      new Error('Some unrelated failure')
    );
    const onError = vi.fn<(e: MountError) => void>();

    const handle = mount(container, {
      referralId: 'val1',
      onError,
    });

    // Microtask drain - init() rejects synchronously, race -> .catch chain
    // needs a few ticks to settle.
    await flushMicrotasks();

    expect(onError).toHaveBeenCalledTimes(1);
    const arg = onError.mock.calls[0]?.[0];
    expect(arg?.code).toBe('unknown');
    expect(arg?.message).toMatch(/unrelated failure/);
    expect(arg?.cause).toBeInstanceOf(Error);

    handle.destroy();
  });

  it('classifies origin-mismatch init failures with code origin_mismatch', async () => {
    vi.spyOn(IframeClient.prototype, 'init').mockRejectedValue(
      new Error('IframeClient: origin mismatch (received https://attacker.example)')
    );
    const onError = vi.fn<(e: MountError) => void>();

    const handle = mount(container, {
      referralId: 'val1',
      onError,
    });
    await flushMicrotasks();

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0]?.[0].code).toBe('origin_mismatch');
    handle.destroy();
  });

  it('classifies contentWindow failures with code iframe_load_failed', async () => {
    vi.spyOn(IframeClient.prototype, 'init').mockRejectedValue(
      new Error('IframeClient: iframe.contentWindow is null')
    );
    const onError = vi.fn<(e: MountError) => void>();

    const handle = mount(container, {
      referralId: 'val1',
      onError,
    });
    await flushMicrotasks();

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0]?.[0].code).toBe('iframe_load_failed');
    handle.destroy();
  });

  it('does not fire onError after destroy() is called pre-timeout', async () => {
    vi.useFakeTimers();
    vi.spyOn(IframeClient.prototype, 'init').mockImplementation(
      () => new Promise(() => {
        /* never resolves */
      })
    );
    const onError = vi.fn();

    const handle = mount(container, {
      referralId: 'val1',
      onError,
    });

    // Destroy before the 15s race rejects. The pending timer is cleared
    // inside destroy(), so the catch handler never fires.
    handle.destroy();
    await vi.advanceTimersByTimeAsync(30_000);
    await vi.runAllTimersAsync();

    expect(onError).not.toHaveBeenCalled();
  });
});

describe('buildIframeSrc()', () => {
  it('produces base URL with ref + v and no theme param when theme is absent', () => {
    const url = buildIframeSrc({ referralId: 'val1' });
    const parsed = new URL(url);
    expect(parsed.origin).toBe('https://atomcircuit.net');
    expect(parsed.pathname).toBe('/embed/swap');
    expect(parsed.searchParams.get('ref')).toBe('val1');
    expect(parsed.searchParams.get('v')).toBeTruthy();
    expect(parsed.searchParams.has('theme')).toBe(false);
  });

  it('appends &theme=<base64> when theme is valid', () => {
    const theme: ThemeOptions = {
      mode: 'dark',
      accentColor: '#7b61ff',
      radius: 12,
    };
    const url = buildIframeSrc({ referralId: 'val1', theme });
    const parsed = new URL(url);
    const themeParam = parsed.searchParams.get('theme');
    expect(themeParam).not.toBeNull();
    expect(themeParam).toBe(encodeTheme(theme));
    const json = (typeof atob === 'function'
      ? atob(themeParam as string)
      : Buffer.from(themeParam as string, 'base64').toString('utf-8'));
    expect(JSON.parse(json)).toEqual(theme);
  });

  it('silently omits the theme param when validation fails', () => {
    const warn = vi.fn();
    const url = buildIframeSrc({
      referralId: 'val1',
      theme: { accentColor: 'not-a-hex' } as unknown as ThemeOptions,
      warn,
    });
    const parsed = new URL(url);
    expect(parsed.searchParams.has('theme')).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toMatch(/theme validation failed/);
  });

  it('silently omits the theme param when radius is out of range', () => {
    const url = buildIframeSrc({
      referralId: 'val1',
      theme: { radius: 999 } as ThemeOptions,
    });
    expect(new URL(url).searchParams.has('theme')).toBe(false);
  });

  it('honors a custom origin and path', () => {
    const url = buildIframeSrc({
      referralId: 'val1',
      origin: 'https://staging.example.com',
      path: '/widget',
    });
    const parsed = new URL(url);
    expect(parsed.origin).toBe('https://staging.example.com');
    expect(parsed.pathname).toBe('/widget');
  });

  it('strips a trailing slash on origin', () => {
    const url = buildIframeSrc({
      referralId: 'val1',
      origin: 'https://atomcircuit.net/',
    });
    expect(url.startsWith('https://atomcircuit.net/embed/swap?')).toBe(true);
  });

  it('encodes chrome into the theme param when valid (chrome-only path)', () => {
    const chrome: ChromeOptions = { logo: false, footer: false };
    const url = buildIframeSrc({ referralId: 'val1', chrome });
    const parsed = new URL(url);
    const param = parsed.searchParams.get('theme');
    expect(param).not.toBeNull();
    expect(param).toBe(encodeTheme({}, chrome));
    const json =
      typeof atob === 'function'
        ? atob(param as string)
        : Buffer.from(param as string, 'base64').toString('utf-8');
    const decoded = JSON.parse(json) as Record<string, unknown>;
    expect(decoded['chrome']).toEqual(chrome);
  });

  it('encodes theme + chrome into a single theme param when both supplied', () => {
    const theme: ThemeOptions = { mode: 'dark', accentColor: '#abc' };
    const chrome: ChromeOptions = { wallet: false };
    const url = buildIframeSrc({ referralId: 'val1', theme, chrome });
    const param = new URL(url).searchParams.get('theme');
    expect(param).not.toBeNull();
    expect(param).toBe(encodeTheme(theme, chrome));
    const json =
      typeof atob === 'function'
        ? atob(param as string)
        : Buffer.from(param as string, 'base64').toString('utf-8');
    const decoded = JSON.parse(json) as Record<string, unknown>;
    expect(decoded['mode']).toBe('dark');
    expect(decoded['accentColor']).toBe('#abc');
    expect(decoded['chrome']).toEqual(chrome);
  });

  it('silently omits chrome when validation fails', () => {
    const warn = vi.fn();
    const url = buildIframeSrc({
      referralId: 'val1',
      chrome: { logo: 'yes' } as unknown as ChromeOptions,
      warn,
    });
    expect(new URL(url).searchParams.has('theme')).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toMatch(/chrome validation failed/);
  });

  it('emits theme alone when chrome fails but theme passes', () => {
    const warn = vi.fn();
    const theme: ThemeOptions = { mode: 'light' };
    const url = buildIframeSrc({
      referralId: 'val1',
      theme,
      chrome: { logo: 1 } as unknown as ChromeOptions,
      warn,
    });
    const param = new URL(url).searchParams.get('theme');
    expect(param).toBe(encodeTheme(theme));
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toMatch(/chrome validation failed/);
  });
});

describe('mount() sizing + theming', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
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

  it('applies width override to the iframe', () => {
    const handle = mount(container, {
      referralId: 'val1',
      width: '480px',
    });
    expect(handle.iframe.style.width).toBe('480px');
    handle.destroy();
  });

  it('applies maxWidth override to the iframe', () => {
    const handle = mount(container, {
      referralId: 'val1',
      maxWidth: '600px',
    });
    expect(handle.iframe.style.maxWidth).toBe('600px');
    handle.destroy();
  });

  it('applies padding to the wrapper, NOT the iframe', () => {
    const handle = mount(container, {
      referralId: 'val1',
      padding: '16px',
    });
    expect(handle.wrapper).not.toBeNull();
    expect(handle.wrapper?.style.padding).toBe('16px');
    expect(handle.iframe.style.padding).toBe('');
    handle.destroy();
  });

  it('defaults iframe width to 100% when not overridden', () => {
    const handle = mount(container, { referralId: 'val1' });
    expect(handle.iframe.style.width).toBe('100%');
    handle.destroy();
  });

  it('applies caller-supplied padding to the wrapper, not the iframe', () => {
    const handle = mount(container, { referralId: 'val1', padding: '8px' });
    expect(handle.wrapper.tagName).toBe('DIV');
    expect(handle.wrapper.hasAttribute('data-atom-circuit-embed')).toBe(true);
    expect(handle.wrapper.style.padding).toBe('8px');
    expect(handle.iframe.style.padding).toBe('');
    expect(handle.iframe.parentElement).toBe(handle.wrapper);
    expect(handle.wrapper.parentElement).toBe(container);
    handle.destroy();
  });

  it('always wraps the iframe in a positioned wrapper so the loading overlay can sit over it', () => {
    const handle = mount(container, { referralId: 'val1' });
    // v1.0.0+ contract: wrapper is always present. Hosts that previously
    // used `container > iframe` should use `container iframe` or
    // `[data-atom-circuit-embed] iframe` selectors instead.
    expect(handle.wrapper).not.toBeNull();
    expect(handle.wrapper.tagName).toBe('DIV');
    expect(handle.wrapper.hasAttribute('data-atom-circuit-embed')).toBe(true);
    expect(handle.wrapper.style.position).toBe('relative');
    expect(handle.iframe.parentElement).toBe(handle.wrapper);
    expect(handle.wrapper.parentElement).toBe(container);
    handle.destroy();
  });

  it('injects a loading overlay sibling of the iframe inside the wrapper', () => {
    const handle = mount(container, { referralId: 'val1' });
    const loader = handle.wrapper.querySelector('[data-atom-circuit-loader]');
    expect(loader).not.toBeNull();
    expect((loader as HTMLElement).style.position).toBe('absolute');
    expect((loader as HTMLElement).style.pointerEvents).toBe('none');
    // Loader is a sibling of the iframe inside the same wrapper, so any
    // CSS targeting `[data-atom-circuit-embed] > iframe` still matches.
    expect(loader?.parentElement).toBe(handle.wrapper);
    expect(handle.iframe.parentElement).toBe(handle.wrapper);
    handle.destroy();
  });

  it('includes the theme param in the iframe src when theme is valid', () => {
    const theme: ThemeOptions = { mode: 'dark', accentColor: '#abc' };
    const handle = mount(container, { referralId: 'val1', theme });
    const src = new URL(handle.iframe.src);
    expect(src.searchParams.get('theme')).toBe(encodeTheme(theme));
    handle.destroy();
  });

  it('omits the theme param when the theme fails validation', () => {
    const handle = mount(container, {
      referralId: 'val1',
      theme: { accentColor: 'oops' } as unknown as ThemeOptions,
    });
    const src = new URL(handle.iframe.src);
    expect(src.searchParams.has('theme')).toBe(false);
    handle.destroy();
  });

  it('removes the wrapper on destroy() when padding is supplied', () => {
    const handle = mount(container, { referralId: 'val1', padding: '8px' });
    expect(handle.wrapper).not.toBeNull();
    const wrapper = handle.wrapper as HTMLDivElement;
    expect(container.contains(wrapper)).toBe(true);
    handle.destroy();
    expect(container.contains(wrapper)).toBe(false);
  });

  it('two mount() calls into the same container append two iframes, each independently destroyable', () => {
    const handle1 = mount(container, { referralId: 'val1' });
    const handle2 = mount(container, { referralId: 'val2' });

    const iframes = container.querySelectorAll('iframe');
    expect(iframes.length).toBe(2);
    expect(iframes[0]).toBe(handle1.iframe);
    expect(iframes[1]).toBe(handle2.iframe);
    expect(handle1.iframe).not.toBe(handle2.iframe);

    // Destroying the first must NOT remove the second.
    handle1.destroy();
    const remaining = container.querySelectorAll('iframe');
    expect(remaining.length).toBe(1);
    expect(remaining[0]).toBe(handle2.iframe);

    // Destroying the second cleans up fully.
    handle2.destroy();
    expect(container.querySelectorAll('iframe').length).toBe(0);
  });
});
