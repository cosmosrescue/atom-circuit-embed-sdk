# Atom Circuit embed examples

Runnable examples for embedding the Atom Circuit swap widget, organized by
language and framework.

```
typescript/react      TypeScript, React (Vite)
typescript/nextjs     TypeScript, Next.js (App Router)
javascript/react      JavaScript, React (Vite)
javascript/nextjs     JavaScript, Next.js (App Router)
vanilla               Plain HTML, no build step
```

Each framework folder is a standalone app with its own README and `package.json`;
`vanilla` is a set of standalone HTML pages. Pick the one matching your stack.

Every framework folder contains the same four examples:

- `minimal` - the basic embed. The user connects their wallet inside the widget.
- `full` - appearance and features: theme, chrome, max width, and validator
  choice.
- `parent-wallet` - reuse a wallet already connected on the page via the raw
  injected providers (`window.keplr` / `window.ethereum`).
- `parent-wallet-cosmoskit` - reuse a wallet already connected on the page when
  you use cosmos-kit for Cosmos and wagmi for EVM. (React and Next.js only;
  cosmos-kit and wagmi are React libraries.)

The `vanilla` folder covers `minimal`, `full`, and `parent-wallet`.
