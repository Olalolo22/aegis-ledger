import { createRequire } from "module";
const require = createRequire(import.meta.url);

/** @type {import('next').NextConfig} */
const nextConfig = {
  /**
   * Webpack polyfills for @cloak.dev/sdk browser execution.
   *
   * The Cloak SDK relies on Node.js built-in modules (crypto, stream, buffer)
   * for Poseidon hashing, UTXO commitment computation, and note encryption.
   * When running in the browser (client-side decryption), Webpack must
   * provide polyfills for these modules.
   *
   * ⚠ This ONLY affects the client bundle. Server-side API routes
   *   use native Node.js modules and are unaffected.
   */
  webpack: (config, { isServer }) => {
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        // Cloak SDK uses Node crypto for Poseidon / commitment hashing
        crypto: false,
        // Stream is required by some transitive dependencies
        stream: false,
        // Buffer used throughout the SDK for byte array handling
        buffer: require.resolve("buffer/"),
        // Other Node built-ins that may be referenced
        path: false,
        fs: false,
        os: false,
        net: false,
        tls: false,
        http: false,
        https: false,
        zlib: false,
        url: false,
        util: false,
        assert: false,
        events: false,
        process: false,
      };

      // Provide global Buffer for browser environment
      const webpack = require("webpack");
      config.plugins.push(
        new webpack.ProvidePlugin({
          Buffer: ["buffer", "Buffer"],
        })
      );
    }
    return config;
  },

  // Suppress ESM/CJS warnings from wallet adapter packages
  transpilePackages: [
    "@solana/wallet-adapter-base",
    "@solana/wallet-adapter-react",
    "@solana/wallet-adapter-react-ui",
    "@solana/wallet-adapter-phantom",
    "@solana/wallet-adapter-solflare",
    "@solana/wallet-adapter-backpack",
  ],
};

export default nextConfig;
