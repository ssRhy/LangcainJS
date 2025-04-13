/** @type {import('next').NextConfig} */
const nextConfig = {
  // 支持混合模块系统
  experimental: {
    esmExternals: true,
  },
  // 配置webpack
  webpack: (config, { isServer }) => {
    if (isServer) {
      config.experiments = {
        ...config.experiments,
        topLevelAwait: true,
      };
    }
    return config;
  },
};

module.exports = nextConfig;
