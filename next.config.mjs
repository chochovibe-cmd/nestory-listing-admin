/** @type {import('next').NextConfig} */
const nextConfig = {
  typedRoutes: false,
  // D3: keep sharp out of the client/webpack bundle; server-only native module.
  serverExternalPackages: ["sharp"],
  outputFileTracingExcludes: {
    "*": ["./.pnpm-store/**", "./\u5206\u652f/**"]
  },
  webpack: (config) => {
    config.watchOptions = {
      ...config.watchOptions,
      ignored: [
        "**/node_modules/**",
        "**/.git/**",
        "**/.next/**",
        "**/.pnpm-store/**",
        "**/\u5206\u652f/**"
      ]
    };

    return config;
  }
};

export default nextConfig;
