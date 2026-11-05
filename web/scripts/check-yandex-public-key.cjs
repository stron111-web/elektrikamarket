'use strict';
const fs = require('node:fs');
const path = require('node:path');

if (process.env.REQUIRE_YANDEX_JS_KEY !== '1') process.exit(0);

const source = fs.readFileSync('lib/yandex-public-key.ts', 'utf8');
const match = source.match(/export const yandexPublicKey = ("(?:\\.|[^"])*");/);
const key = match ? JSON.parse(match[1]) : '';
if (key.length < 20) {
  console.error('preview build did not receive the yandex js key');
  process.exit(1);
}

function files(dir, found = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files(full, found);
    else if (entry.name.endsWith('.js')) found.push(full);
  }
  return found;
}

const compiled = files('.next').some((file) => fs.readFileSync(file, 'utf8').includes(key));
if (!compiled) {
  console.error('yandex key was not compiled into the preview bundle');
  process.exit(1);
}
console.log('yandex_js_key_in_bundle=yes');
