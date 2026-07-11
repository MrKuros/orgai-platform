/** @type {import('next').NextConfig} */
const nextConfig = {
  env: {
    // ?? not ||: self-host images build with NEXT_PUBLIC_API_URL="" so the
    // browser calls same-origin /v1/* and the rewrite below proxies to the API.
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8080',
  },
  async rewrites() {
    // API_PROXY_URL is a build arg set only by the self-host Docker image
    // (rewrites are baked at build time). Unset everywhere else -> no rewrites.
    return process.env.API_PROXY_URL
      ? [{ source: '/v1/:path*', destination: `${process.env.API_PROXY_URL}/v1/:path*` }]
      : [];
  },
}

module.exports = nextConfig
