/** @type {import('next').NextConfig} */
const nextConfig = {
    // Base path for domain routing: https://identuslabel.cz/bob
    // Can be disabled via environment variable for direct IP access
    basePath: process.env.DISABLE_BASE_PATH ? '' : '/bob',

    // Asset prefix for correct resource loading
    assetPrefix: process.env.DISABLE_BASE_PATH ? '' : '/bob',

    webpack: (config, { isServer }) => {
        if (!isServer) {
            config.resolve.fallback = {
                fs: false,
                crypto: false,
                stream: false,
                path: false,
                buffer: require.resolve('buffer/'),  // Add Buffer polyfill for browser
            };

            // Provide Buffer global for browser
            config.plugins.push(
                new (require('webpack').ProvidePlugin)({
                    Buffer: ['buffer', 'Buffer'],
                })
            );
        }
        return config;
    },
}

module.exports = nextConfig
