# Atom Circuit vanilla examples

Plain HTML pages that load the widget from the CDN with a single script tag. No
build step and no framework. Each file is a complete, self-contained page.

## Run

Open a file in a browser, or serve the folder with any static server:

```sh
npx serve .
```

The `parent-wallet` example uses the wallet bridge, which validates the parent
origin, so serve it over `http://` rather than opening it from `file://`.

## Examples

- `minimal.html` - the basic embed; the user connects their wallet inside the widget.
- `full.html` - theme, chrome, max width, and validator choice.
- `parent-wallet.html` - reuse a wallet already connected on the page via the raw
  injected providers (`window.keplr` / `window.ethereum`).

## Configuration

The `parent-wallet` example runs in parent-wallet mode, which needs no
configuration; the widget trusts its actual embedding origin, which the browser
supplies and a page cannot spoof. `minimal` and `full` require no configuration.

The script tag pins a version and Subresource Integrity hash. When you change the
SDK version, update both the version in the URL and the `integrity` attribute.
