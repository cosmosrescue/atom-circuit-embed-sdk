/**
 * Public entrypoint for the Atom Circuit Embed SDK.
 *
 * Only the spec exports are surfaced here: `mount`, `MountOptions`,
 * `WidgetEvent`, `PROTOCOL_VERSION`, and the theming/chrome contracts.
 * Internal helpers (IframeClient, attachResize, sandbox attribute, type
 * guards, etc.) live in their source modules and are imported directly by
 * `react.tsx` and `vanilla.ts` rather than re-exported here. This keeps the
 * public surface narrow so internal refactors do not break downstream
 * consumers.
 */

export { mount, PROTOCOL_VERSION } from './mount.js';
export type { MountOptions, MountResult } from './mount.js';
export type {
  ChromeOptions,
  MountError,
  MountErrorCode,
  ReadyPayload,
  SwapErrorPayload,
  SwapRouteSummary,
  SwapSubmittedPayload,
  SwapSuccessPayload,
  ThemeOptions,
  WidgetEvent,
} from './protocol.js';
