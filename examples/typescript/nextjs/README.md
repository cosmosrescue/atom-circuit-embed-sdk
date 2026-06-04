# Atom Circuit Next.js examples

A runnable Next.js (App Router) app demonstrating each way to embed the Atom
Circuit swap widget. Each file under `examples/` is an independent integration.
`app/` is the dev harness that mounts them; it is not part of any integration.

## Run

```sh
npm install
npm run dev
```

The nav switches between examples, or pass `?example=<name>`.

## Examples

- `minimal` - the basic embed; the user connects their wallet inside the widget.
- `full` - theme, chrome, max width, and validator choice.
- `parent-wallet` - reuse the page's connected wallet via the raw injected
  providers (`window.keplr` / `window.ethereum`).
- `parent-wallet-cosmoskit` - reuse the page's connected wallet via cosmos-kit
  (Cosmos) and wagmi (EVM).

## Configuration

Parent-wallet mode needs no configuration; the widget trusts its actual
embedding origin, which the browser supplies and a page cannot spoof.
`parent-wallet-cosmoskit` does require a WalletConnect project id for
cosmos-kit and wagmi, set through the `YOUR_WALLETCONNECT_PROJECT_ID` constant at
the top of the file. `minimal` and `full` require no configuration.

## Next.js notes

Each example is a client component that imports the widget through
`next/dynamic` with `ssr: false`, keeping the iframe-only code out of the server
bundle. The SDK is listed in `transpilePackages` in `next.config.js`.
