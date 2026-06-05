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

  if (theme['card'] !== undefined) {
    if (!isHexColor(theme['card'])) return null;
    out.card = theme['card'];
  }

  if (theme['cardSecondary'] !== undefined) {
    if (!isHexColor(theme['cardSecondary'])) return null;
    out.cardSecondary = theme['cardSecondary'];
  }

  if (theme['input'] !== undefined) {
    if (!isHexColor(theme['input'])) return null;
    out.input = theme['input'];
  }

  if (theme['mutedForeground'] !== undefined) {
    if (!isHexColor(theme['mutedForeground'])) return null;
    out.mutedForeground = theme['mutedForeground'];
  }

  if (theme['accentForeground'] !== undefined) {
    if (!isHexColor(theme['accentForeground'])) return null;
    out.accentForeground = theme['accentForeground'];
  }

  if (theme['borderFocus'] !== undefined) {
    if (!isHexColor(theme['borderFocus'])) return null;
    out.borderFocus = theme['borderFocus'];
  }

  if (theme['warning'] !== undefined) {
    if (!isHexColor(theme['warning'])) return null;
    out.warning = theme['warning'];
  }

  if (theme['success'] !== undefined) {
    if (!isHexColor(theme['success'])) return null;
    out.success = theme['success'];
  }

  if (theme['error'] !== undefined) {
    if (!isHexColor(theme['error'])) return null;
    out.error = theme['error'];
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
 * Validate the host-supplied `allowReferralChoice` flag. Returns `true` only
 * when the input is the strict boolean `true`; every other value (including
 * `false`, `undefined`, numbers, strings, objects) collapses to `false`.
 *
 * The asymmetry is intentional: the wire only ever carries the flag when it
 * is `true` (see {@link encodeTheme}), so the default-false path produces a
 * payload byte-identical to the prior protocol output. An invalid value is
 * dropped (treated as false) rather than rejecting the whole theme, matching
 * the orthogonal-toggle discipline used for chrome.
 */
export function validateAllowReferralChoice(value: unknown): boolean {
  return value === true;
}

/**
 * Default {@link MountOptions.maxScale} when autoscale is on but no explicit
 * cap is supplied (or an invalid one is dropped).
 */
export const DEFAULT_MAX_SCALE = 1.5;

/**
 * Lower / upper clamp bounds for {@link MountOptions.maxScale}.
 */
export const MAX_SCALE_MIN = 1.0;
export const MAX_SCALE_MAX = 3.0;

/**
 * Validate the host-supplied `autoscale` flag. Returns `true` only when the
 * input is the strict boolean `true`; every other value (including `false`,
 * `undefined`, numbers, strings, objects) collapses to `false`.
 *
 * The asymmetry mirrors {@link validateAllowReferralChoice}: the wire only
 * ever carries the flag when it is `true` (see {@link encodeTheme}), so the
 * default-false path produces a payload byte-identical to the prior protocol
 * output. An invalid value is dropped (treated as false) rather than rejecting
 * the whole theme.
 */
export function validateAutoscale(value: unknown): boolean {
  return value === true;
}

/**
 * Validate the host-supplied `maxScale` value. Returns a finite number clamped
 * to the inclusive range [{@link MAX_SCALE_MIN}, {@link MAX_SCALE_MAX}]. A
 * non-number, NaN, or infinite value falls back to {@link DEFAULT_MAX_SCALE}
 * rather than rejecting the rest of the payload (orthogonal-drop discipline).
 *
 * An in-range value is returned verbatim; an out-of-range finite value is
 * clamped to the nearest bound (so 0.5 -> 1.0 and 5 -> 3.0).
 */
export function validateMaxScale(value: unknown): number {
  if (!isFiniteNumber(value)) return DEFAULT_MAX_SCALE;
  if (value < MAX_SCALE_MIN) return MAX_SCALE_MIN;
  if (value > MAX_SCALE_MAX) return MAX_SCALE_MAX;
  return value;
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
 * An optional `allowReferralChoice` flag is attached under the reserved
 * top-level `allowReferralChoice` key, but ONLY when it is the strict boolean
 * `true`. The default (`false` / `undefined`) is omitted so a no-config embed
 * produces a payload byte-identical to the prior protocol output.
 *
 * An optional layout options bag carries the autoscale feature. `autoscale`
 * is attached under the top-level `autoscale` key ONLY when it is the strict
 * boolean `true`; when it is, `maxScale` rides alongside it under the
 * `maxScale` key (already validated/clamped by the caller). When autoscale is
 * absent / false BOTH keys are omitted, so an embed that does not opt into
 * autoscale produces a payload byte-identical to the prior protocol output.
 * The trailing `options` argument is a bag rather than two more positional
 * params so existing positional callers stay byte-identical.
 *
 * Browser path uses `btoa(JSON.stringify(payload))`. Node fallback (tests)
 * uses `Buffer.from(...).toString('base64')`. Either way the output is
 * standard base64 - the dapp side decodes with the matching primitive.
 */
export function encodeTheme(
  theme: ThemeOptions,
  chrome?: ChromeOptions | null,
  allowReferralChoice?: boolean,
  options?: { autoscale?: boolean; maxScale?: number } | null
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
  if (allowReferralChoice === true) {
    compact['allowReferralChoice'] = true;
  }
  // autoscale + maxScale: only carried when autoscale is the strict boolean
  // `true`. maxScale is meaningless without autoscale, so it rides only when
  // the flag is on. Both keys are omitted otherwise so the default-off path is
  // byte-identical to prior output.
  if (options?.autoscale === true) {
    compact['autoscale'] = true;
    compact['maxScale'] = validateMaxScale(options.maxScale);
  }
  const json = JSON.stringify(compact);
  if (typeof btoa === 'function') {
    return btoa(json);
  }
  // Node fallback for unit tests / SSR contexts.
  return Buffer.from(json, 'utf-8').toString('base64');
}
