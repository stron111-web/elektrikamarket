'use strict';
const fs = require('node:fs');
try {
  const url = new URL(fs.readFileSync('/run/secrets/storefront_database_url', 'utf8').trim());
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || decodeURIComponent(url.username) !== 'storefront_test_ro' || url.pathname !== '/elektrikamarket_test_20261029t010219z_2761a73c') throw Error('Wrong demo target');
  process.env.DATABASE_URL = url.toString();
  require('/app/demos/catalogs/server.js');
} catch {
  console.error('Demo startup failed: verify the read-only runtime mount.');
  process.exitCode = 1;
}
