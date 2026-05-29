/**
 * Theme validation + encoding for the embed SDK.
 *
 * The host SDK is the trust boundary: every theme that crosses into the
 * iframe URL passes through {@link validateTheme} first, which returns a
 * deep-cloned, fully-validated object or null. The iframe receives the
 * theme as base64-encoded JSON in the `?theme=` query param (see
 * {@link encodeTheme}); the dapp on the iframe side decodes and applies
 * the validated subset as CSS custom properties.
 *
 * Validation is intentionally strict (hex colors only, character allowlist
 * on fontFamily, tight numeric ranges) so a malformed or hostile theme can
 * neither break the embed nor be used as a CSS-injection vector. Any single
 * field failing validation drops the entire theme.
 */

import type { ChromeOptions, ThemeOptions } from './protocol.js';

const HEX_COLOR_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

/**
 * fontFamily allowlist: letters, digits, spaces, hyphens, commas, single
 * and double quotes, dots. Anything else (including `<>;{}=()`, newlines,
 * tabs, semicolons, etc) is rejected.
 */
const FONT_FAMILY_RE = /^[a-zA-Z0-9 ,'".\-]+$/;

const FONT_FAMILY_MAX_LEN = 200;

const MODES: ReadonlySet<'light' | 'dark' | 'auto'> = new Set([
  'light',
  'dark',
  'auto',
]);

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const isString = (value: unknown): value is string => typeof value === 'string';

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

function isHexColor(value: unknown): value is string {
  return isString(value) && HEX_COLOR_RE.test(value);
}

function isValidMode(value: unknown): value is 'light' | 'dark' | 'auto' {
  return isString(value) && MODES.has(value as 'light' | 'dark' | 'auto');
}

function isValidFontFamily(value: unknown): value is string {
  if (!isString(value)) return false;
  if (value.length === 0 || value.length > FONT_FAMILY_MAX_LEN) return false;
  return FONT_FAMILY_RE.test(value);
}

/**
 * Validate an unknown theme value. Returns a deep-cloned ThemeOptions object
 * containing only the present (defined) fields if every field that is
 * present passes its validator. Returns null if the input is not an object
 * or if any present field fails validation.
 *
 * Partial themes are allowed: only the keys that appear in the input are
 * validated and carried through. Undefined keys are skipped silently.
 */
export function validateTheme(theme: unknown): ThemeOptions | null {
  if (!isObject(theme)) return null;

  const out: {
    -readonly [K in keyof ThemeOptions]: ThemeOptions[K];
  } = {};

  if (theme['mode'] !== undefined) {
    if (!isValidMode(theme['mode'])) return null;
    out.mode = theme['mode'];
  }

  if (theme['accentColor'] !== undefined) {
    if (!isHexColor(theme['accentColor'])) return null;
    out.accentColor = theme['accentColor'];
  }

  if (theme['background'] !== undefined) {
    if (!isHexColor(theme['background'])) return null;
    out.background = theme['background'];
  }

  if (theme['foreground'] !== undefined) {
    if (!isHexColor(theme['foreground'])) return null;
    out.foreground = theme['foreground'];
  }

  if (theme['border'] !== undefined) {
    if (!isHexColor(theme['border'])) return null;
    out.border = theme['border'];
  }

  if (theme['radius'] !== undefined) {
    const r = theme['radius'];
    if (!isFiniteNumber(r) || r < 0 || r > 64) return null;
    out.radius = r;
  }

  if (theme['fontSize'] !== undefined) {
    const fs = theme['fontSize'];
    if (!isFiniteNumber(fs) || fs < 8 || fs > 32) return null;
    out.fontSize = fs;
  }

  if (theme['fontFamily'] !== undefined) {
    if (!isValidFontFamily(theme['fontFamily'])) return null;
    out.fontFamily = theme['fontFamily'];
  }

  return out;
}

const isBoolean = (value: unknown): value is boolean => typeof value === 'boolean';

/**
 * Validate an unknown chrome value. Returns a deep-cloned ChromeOptions
 * object containing only the present (defined) fields if every field that is
 * present is a boolean. Returns null if the input is not an object or if any
 * present field is non-boolean.
 *
 * Partial chrome bundles are allowed: only the keys that appear in the input
 * are validated and carried through. Undefined keys are skipped silently.
 */
export function validateChrome(chrome: unknown): ChromeOptions | null {
  if (!isObject(chrome)) return null;

  const out: {
    -readonly [K in keyof ChromeOptions]: ChromeOptions[K];
  } = {};

  if (chrome['logo'] !== undefined) {
    if (!isBoolean(chrome['logo'])) return null;
    out.logo = chrome['logo'];
  }

  if (chrome['wallet'] !== undefined) {
    if (!isBoolean(chrome['wallet'])) return null;
    out.wallet = chrome['wallet'];
  }

  if (chrome['validator'] !== undefined) {
    if (!isBoolean(chrome['validator'])) return null;
    out.validator = chrome['validator'];
  }

  if (chrome['footer'] !== undefined) {
    if (!isBoolean(chrome['footer'])) return null;
    out.footer = chrome['footer'];
  }

  return out;
}

/**
 * Encode a validated theme as URL-safe base64(JSON). Skips null/undefined
 * fields so the encoded payload only carries keys actually set by the host.
 *
 * An optional validated chrome bundle is attached under the reserved
 * `chrome` key inside the same JSON payload so the existing `?theme=`
 * iframe-URL parameter carries both. The dapp side decodes the combined
 * payload and applies each half independently.
 *
 * Browser path uses `btoa(JSON.stringify(payload))`. Node fallback (tests)
 * uses `Buffer.from(...).toString('base64')`. Either way the output is
 * standard base64 - the dapp side decodes with the matching primitive.
 */
export function encodeTheme(
  theme: ThemeOptions,
  chrome?: ChromeOptions | null
): string {
  const compact: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(theme)) {
    if (value === null || value === undefined) continue;
    compact[key] = value;
  }
  if (chrome && Object.keys(chrome).length > 0) {
    const chromeCompact: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(chrome)) {
      if (value === null || value === undefined) continue;
      chromeCompact[key] = value;
    }
    if (Object.keys(chromeCompact).length > 0) {
      compact['chrome'] = chromeCompact;
    }
  }
  const json = JSON.stringify(compact);
  if (typeof btoa === 'function') {
    return btoa(json);
  }
  // Node fallback for unit tests / SSR contexts.
  return Buffer.from(json, 'utf-8').toString('base64');
}
