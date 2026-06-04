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
export { WALLET_SIGNAL_NS, EVM_BRIDGE_NS } from './protocol.js';
export type {
  ChromeOptions,
  Eip1193ProviderLike,
  MountError,
  MountErrorCode,
  OfflineSignerLike,
  ReadyPayload,
  SwapErrorPayload,
  SwapRouteSummary,
  SwapSubmittedPayload,
  SwapSuccessPayload,
  ThemeOptions,
  WalletCapabilitiesMessage,
  WalletChannel,
  WalletConnectRequestMessage,
  WalletCosmosHandle,
  WalletEvmHandle,
  WalletGoneMessage,
  WalletHelloMessage,
  WalletOptions,
  WalletReadyMessage,
  WalletSignalMessage,
  WidgetEvent,
} from './protocol.js';
export {
  fromCosmosKit,
  fromInjectedCosmosWallet,
  fromKeplr,
  fromWagmi,
} from './helpers.js';
export type {
  CosmosKitClientLike,
  DerivedCosmosAccount,
  DerivedCosmosSimpleAccount,
  FromCosmosKitOptions,
  FromInjectedCosmosWalletOptions,
  FromKeplrOptions,
  KeplrInjectedProviderLike,
  KeplrKeyLike,
} from './helpers.js';
