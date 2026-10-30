'use strict';
const fs = require('node:fs');
try {
  const file = process.env.DATABASE_URL_FILE || '/run/secrets/storefront_database_url';
  const role = process.env.STOREFRONT_DATABASE_ROLE || 'storefront_test_ro';
  if (!['storefront_test_ro', 'storefront_preview_ro'].includes(role)) throw new Error('unexpected database role');
  const url = new URL(fs.readFileSync(file, 'utf8').trim());
  if (!['postgres:', 'postgresql:'].includes(url.protocol) ||
      decodeURIComponent(url.username) !== role ||
      url.pathname !== '/elektrikamarket_test_20261029t010219z_2761a73c') {
    throw new Error('unexpected database target');
  }
  process.env.DATABASE_URL = url.toString();
  require('/app/web/server.js');
} catch {
  console.error('Storefront startup failed: verify the runtime database secret and image.');
  process.exitCode = 1;
}
