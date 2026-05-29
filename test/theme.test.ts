import { describe, it, expect } from 'vitest';

import { encodeTheme, validateChrome, validateTheme } from '../src/theme.js';
import type { ChromeOptions, ThemeOptions } from '../src/protocol.js';

describe('validateTheme', () => {
  describe('positive cases', () => {
    it('accepts a fully-populated valid theme', () => {
      const input: ThemeOptions = {
        mode: 'dark',
        accentColor: '#7b61ff',
        background: '#0d0f14',
        foreground: '#f5f6fa',
        border: '#1f2330',
        radius: 12,
        fontSize: 14,
        fontFamily: 'Inter, system-ui, sans-serif',
      };
      const out = validateTheme(input);
      expect(out).not.toBeNull();
      expect(out).toEqual(input);
    });

    it('accepts a partial theme with only mode', () => {
      expect(validateTheme({ mode: 'light' })).toEqual({ mode: 'light' });
    });

    it('accepts a partial theme with only accentColor', () => {
      expect(validateTheme({ accentColor: '#abc' })).toEqual({ accentColor: '#abc' });
    });

    it('accepts a partial theme with only radius', () => {
      expect(validateTheme({ radius: 0 })).toEqual({ radius: 0 });
      expect(validateTheme({ radius: 64 })).toEqual({ radius: 64 });
    });

    it('accepts an empty object', () => {
      expect(validateTheme({})).toEqual({});
    });

    it('accepts all three mode values', () => {
      expect(validateTheme({ mode: 'light' })).toEqual({ mode: 'light' });
      expect(validateTheme({ mode: 'dark' })).toEqual({ mode: 'dark' });
      expect(validateTheme({ mode: 'auto' })).toEqual({ mode: 'auto' });
    });

    it('accepts both 3-digit and 6-digit hex colors', () => {
      expect(validateTheme({ accentColor: '#fff' })).toEqual({ accentColor: '#fff' });
      expect(validateTheme({ accentColor: '#FFFFFF' })).toEqual({ accentColor: '#FFFFFF' });
      expect(validateTheme({ background: '#012abc' })).toEqual({ background: '#012abc' });
    });

    it('accepts fontFamily with quotes, commas, spaces, hyphens, dots', () => {
      const ff = `"SF Pro Display", 'Helvetica Neue', system-ui, sans-serif`;
      expect(validateTheme({ fontFamily: ff })).toEqual({ fontFamily: ff });
    });

    it('produces a deep-cloned object distinct from the input', () => {
      const input: ThemeOptions = { mode: 'dark', accentColor: '#abc' };
      const out = validateTheme(input);
      expect(out).not.toBe(input);
      expect(out).toEqual(input);
    });

    it('skips undefined fields silently', () => {
      const out = validateTheme({ mode: 'dark', accentColor: undefined });
      expect(out).toEqual({ mode: 'dark' });
      expect(out).not.toHaveProperty('accentColor');
    });
  });

  describe('negative cases', () => {
    it('returns null for non-objects', () => {
      expect(validateTheme(null)).toBeNull();
      expect(validateTheme(undefined)).toBeNull();
      expect(validateTheme('dark')).toBeNull();
      expect(validateTheme(42)).toBeNull();
      expect(validateTheme(true)).toBeNull();
    });

    it('rejects malformed hex colors', () => {
      expect(validateTheme({ accentColor: '#1234' })).toBeNull();
      expect(validateTheme({ accentColor: '#abcdef0' })).toBeNull();
      expect(validateTheme({ accentColor: '#12' })).toBeNull();
      expect(validateTheme({ accentColor: 'blue' })).toBeNull();
      expect(validateTheme({ accentColor: 'rgb(0,0,0)' })).toBeNull();
      expect(validateTheme({ accentColor: 'rgba(0,0,0,0.5)' })).toBeNull();
      expect(validateTheme({ accentColor: 'hsl(120,100%,50%)' })).toBeNull();
      expect(validateTheme({ accentColor: '#zzz' })).toBeNull();
      expect(validateTheme({ accentColor: '' })).toBeNull();
      expect(validateTheme({ accentColor: '#abc;color:red' })).toBeNull();
    });

    it('rejects malformed background/foreground/border the same way', () => {
      expect(validateTheme({ background: 'red' })).toBeNull();
      expect(validateTheme({ foreground: 'rgb(0,0,0)' })).toBeNull();
      expect(validateTheme({ border: '#xyz' })).toBeNull();
    });

    it('rejects out-of-range radius', () => {
      expect(validateTheme({ radius: -1 })).toBeNull();
      expect(validateTheme({ radius: 65 })).toBeNull();
      expect(validateTheme({ radius: 1000 })).toBeNull();
      expect(validateTheme({ radius: Number.NaN })).toBeNull();
      expect(validateTheme({ radius: Number.POSITIVE_INFINITY })).toBeNull();
      expect(validateTheme({ radius: '12' })).toBeNull();
    });

    it('rejects out-of-range fontSize', () => {
      expect(validateTheme({ fontSize: 7 })).toBeNull();
      expect(validateTheme({ fontSize: 33 })).toBeNull();
      expect(validateTheme({ fontSize: 0 })).toBeNull();
      expect(validateTheme({ fontSize: Number.NaN })).toBeNull();
      expect(validateTheme({ fontSize: '14' })).toBeNull();
    });

    it('rejects fontFamily containing forbidden characters', () => {
      expect(validateTheme({ fontFamily: 'Inter<script>' })).toBeNull();
      expect(validateTheme({ fontFamily: 'Inter; color: red' })).toBeNull();
      expect(validateTheme({ fontFamily: 'Inter{x}' })).toBeNull();
      expect(validateTheme({ fontFamily: 'Inter=evil' })).toBeNull();
      expect(validateTheme({ fontFamily: 'Inter(arg)' })).toBeNull();
      expect(validateTheme({ fontFamily: 'Inter\nsystem-ui' })).toBeNull();
      expect(validateTheme({ fontFamily: 'Inter\tsystem-ui' })).toBeNull();
      expect(validateTheme({ fontFamily: 'Inter>evil' })).toBeNull();
    });

    it('rejects fontFamily over 200 chars', () => {
      const long = 'a'.repeat(201);
      expect(validateTheme({ fontFamily: long })).toBeNull();
      const justOver = 'a'.repeat(200) + 'b';
      expect(validateTheme({ fontFamily: justOver })).toBeNull();
    });

    it('accepts fontFamily at exactly 200 chars', () => {
      const exact = 'a'.repeat(200);
      expect(validateTheme({ fontFamily: exact })).toEqual({ fontFamily: exact });
    });

    it('rejects empty fontFamily', () => {
      expect(validateTheme({ fontFamily: '' })).toBeNull();
    });

    it('rejects invalid mode', () => {
      expect(validateTheme({ mode: 'system' })).toBeNull();
      expect(validateTheme({ mode: 'Light' })).toBeNull();
      expect(validateTheme({ mode: '' })).toBeNull();
      expect(validateTheme({ mode: 42 })).toBeNull();
    });

    it('drops the entire theme when ANY field fails', () => {
      const out = validateTheme({
        mode: 'dark',
        accentColor: '#abc',
        radius: 999,
      });
      expect(out).toBeNull();
    });
  });
});

describe('encodeTheme', () => {
  function decode(b64: string): string {
    if (typeof atob === 'function') return atob(b64);
    return Buffer.from(b64, 'base64').toString('utf-8');
  }

  it('produces valid base64 of compact JSON', () => {
    const theme: ThemeOptions = { mode: 'dark', accentColor: '#abc', radius: 12 };
    const encoded = encodeTheme(theme);
    expect(typeof encoded).toBe('string');
    const json = decode(encoded);
    expect(json).toBe('{"mode":"dark","accentColor":"#abc","radius":12}');
    expect(JSON.parse(json)).toEqual(theme);
  });

  it('round-trips a full theme', () => {
    const theme: ThemeOptions = {
      mode: 'auto',
      accentColor: '#7b61ff',
      background: '#0d0f14',
      foreground: '#f5f6fa',
      border: '#1f2330',
      radius: 12,
      fontSize: 14,
      fontFamily: 'Inter, sans-serif',
    };
    const encoded = encodeTheme(theme);
    const parsed = JSON.parse(decode(encoded));
    expect(parsed).toEqual(theme);
  });

  it('skips null and undefined fields', () => {
    // Cast through unknown so we can deliberately exercise the runtime skip
    // even though the public type forbids null values.
    const theme = {
      mode: 'dark',
      accentColor: undefined,
      background: null,
      radius: 12,
    } as unknown as ThemeOptions;
    const encoded = encodeTheme(theme);
    const parsed = JSON.parse(decode(encoded));
    expect(parsed).toEqual({ mode: 'dark', radius: 12 });
    expect(parsed).not.toHaveProperty('accentColor');
    expect(parsed).not.toHaveProperty('background');
  });

  it('produces an output URLSearchParams will not mangle when re-encoded', () => {
    const theme: ThemeOptions = { mode: 'dark', accentColor: '#abc' };
    const encoded = encodeTheme(theme);
    const params = new URLSearchParams();
    params.set('theme', encoded);
    const round = params.get('theme');
    expect(round).toBe(encoded);
    expect(JSON.parse(decode(round as string))).toEqual(theme);
  });

  it('returns deterministic output for the same input', () => {
    const theme: ThemeOptions = { mode: 'dark', radius: 8 };
    expect(encodeTheme(theme)).toBe(encodeTheme(theme));
  });
});

describe('validateChrome', () => {
  function decode(b64: string): string {
    if (typeof atob === 'function') return atob(b64);
    return Buffer.from(b64, 'base64').toString('utf-8');
  }

  describe('positive cases', () => {
    it('accepts a fully-populated chrome bundle', () => {
      const input: ChromeOptions = {
        logo: true,
        wallet: true,
        validator: false,
        footer: false,
      };
      expect(validateChrome(input)).toEqual(input);
    });

    it('accepts partial bundles with only one flag', () => {
      expect(validateChrome({ logo: false })).toEqual({ logo: false });
      expect(validateChrome({ wallet: false })).toEqual({ wallet: false });
      expect(validateChrome({ validator: false })).toEqual({ validator: false });
      expect(validateChrome({ footer: false })).toEqual({ footer: false });
    });

    it('accepts true values', () => {
      expect(validateChrome({ logo: true, wallet: true })).toEqual({
        logo: true,
        wallet: true,
      });
    });

    it('accepts an empty object', () => {
      expect(validateChrome({})).toEqual({});
    });

    it('skips undefined fields silently', () => {
      const out = validateChrome({ logo: true, wallet: undefined });
      expect(out).toEqual({ logo: true });
      expect(out).not.toHaveProperty('wallet');
    });

    it('produces a clone distinct from the input', () => {
      const input: ChromeOptions = { logo: false };
      const out = validateChrome(input);
      expect(out).not.toBe(input);
      expect(out).toEqual(input);
    });
  });

  describe('negative cases', () => {
    it('returns null for non-objects', () => {
      expect(validateChrome(null)).toBeNull();
      expect(validateChrome(undefined)).toBeNull();
      expect(validateChrome('true')).toBeNull();
      expect(validateChrome(1)).toBeNull();
      expect(validateChrome(false)).toBeNull();
    });

    it('rejects non-boolean values per field', () => {
      expect(validateChrome({ logo: 'true' })).toBeNull();
      expect(validateChrome({ logo: 1 })).toBeNull();
      expect(validateChrome({ logo: 0 })).toBeNull();
      expect(validateChrome({ wallet: null })).toBeNull();
      expect(validateChrome({ validator: 'false' })).toBeNull();
      expect(validateChrome({ footer: {} })).toBeNull();
    });

    it('drops the entire bundle when any field fails', () => {
      const out = validateChrome({
        logo: true,
        wallet: 'yes',
        validator: true,
      });
      expect(out).toBeNull();
    });
  });

  describe('encodeTheme with chrome bundle', () => {
    it('attaches chrome under the chrome key inside the payload', () => {
      const theme: ThemeOptions = { mode: 'dark' };
      const chrome: ChromeOptions = { logo: false, footer: false };
      const encoded = encodeTheme(theme, chrome);
      const json = decode(encoded);
      const parsed = JSON.parse(json) as Record<string, unknown>;
      expect(parsed['mode']).toBe('dark');
      expect(parsed['chrome']).toEqual({ logo: false, footer: false });
    });

    it('omits the chrome key when chrome is empty', () => {
      const theme: ThemeOptions = { mode: 'dark' };
      const encoded = encodeTheme(theme, {});
      const parsed = JSON.parse(decode(encoded)) as Record<string, unknown>;
      expect(parsed).not.toHaveProperty('chrome');
    });

    it('omits the chrome key when chrome is undefined', () => {
      const theme: ThemeOptions = { mode: 'dark' };
      const encoded = encodeTheme(theme);
      const parsed = JSON.parse(decode(encoded)) as Record<string, unknown>;
      expect(parsed).not.toHaveProperty('chrome');
    });

    it('skips null and undefined fields inside chrome', () => {
      const theme: ThemeOptions = { mode: 'dark' };
      const chrome = {
        logo: false,
        wallet: undefined,
        validator: null,
        footer: true,
      } as unknown as ChromeOptions;
      const encoded = encodeTheme(theme, chrome);
      const parsed = JSON.parse(decode(encoded)) as Record<string, unknown>;
      expect(parsed['chrome']).toEqual({ logo: false, footer: true });
    });

    it('allows a chrome-only payload (empty theme)', () => {
      const chrome: ChromeOptions = { logo: false };
      const encoded = encodeTheme({}, chrome);
      const parsed = JSON.parse(decode(encoded)) as Record<string, unknown>;
      expect(parsed['chrome']).toEqual({ logo: false });
    });
  });
});
