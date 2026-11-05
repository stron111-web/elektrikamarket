'use strict';
const fs = require('node:fs');

let key = (process.env.NEXT_PUBLIC_YANDEX_JS_API_KEY || '').trim();
try {
  const fromFile = fs.readFileSync('/run/secrets/yandex_js_key', 'utf8').trim();
  if (fromFile) key = fromFile;
} catch { /* секрет сборки есть только у превью */ }

if (process.env.REQUIRE_YANDEX_JS_KEY === '1' && key.length < 20) {
  console.error('preview build did not receive the yandex js key');
  process.exit(1);
}

fs.writeFileSync('lib/yandex-public-key.ts', `export const yandexPublicKey = ${JSON.stringify(key)};\n`);
console.log(`yandex_js_key_length=${key.length}`);
