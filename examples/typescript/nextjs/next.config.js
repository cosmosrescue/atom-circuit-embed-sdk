/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The SDK ships ESM. transpilePackages bundles it through the app's pipeline
  // and avoids node_modules ESM resolution friction in Next.
  transpilePackages: ['@atom-circuit/embed-sdk'],
  webpack: (config) => {
    // wagmi's connectors barrel (@wagmi/connectors) re-exports every connector
    // unconditionally, including ones whose SDKs are optional peer dependencies.
    // This app uses only the injected and walletConnect connectors, so the
    // others are not installed. Alias the unused optional peers to false so
    // webpack does not fail on the missing modules while bundling the barrel.
    config.resolve.alias = {
      ...config.resolve.alias,
      'porto/internal': false,
      porto: false,
      '@base-org/account': false,
      '@coinbase/wallet-sdk': false,
      '@metamask/connect-evm': false,
      '@safe-global/safe-apps-provider': false,
      '@safe-global/safe-apps-sdk': false,
      accounts: false,
    };
    return config;
  },
};

module.exports = nextConfig;
