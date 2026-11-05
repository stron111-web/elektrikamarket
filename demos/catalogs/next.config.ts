import type { NextConfig } from 'next';
import path from 'node:path';
const config: NextConfig = {
  output: 'standalone', poweredByHeader: false,
  serverExternalPackages: ['postgres'],
  outputFileTracingRoot: path.resolve(process.cwd(), '../..'),
  async headers() { return [{ source: '/:path*', headers: [
    { key: 'X-Robots-Tag', value: 'noindex, nofollow, noarchive' },
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'Referrer-Policy', value: 'no-referrer' },
  ] }]; },
};
export default config;
