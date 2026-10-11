import type { NextConfig } from 'next';
import path from 'node:path';
const config: NextConfig = { serverExternalPackages: ['postgres', 'dotenv'], poweredByHeader: false, outputFileTracingRoot: path.resolve(process.cwd(), '..') };
export default config;
