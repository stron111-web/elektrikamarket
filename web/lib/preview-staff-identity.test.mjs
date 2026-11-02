import test from 'node:test';
import assert from 'node:assert/strict';
import { previewStaffEmail } from './preview-staff-identity.ts';
const env = { PREVIEW_STAFF_BASIC_AUTH: '1', STOREFRONT_DATABASE_ROLE: 'storefront_preview_ro', PREVIEW_STAFF_MAP: JSON.stringify({owner:'owner@example.invalid',developer:'developer@example.invalid'}) };
const basic = user => 'Basic '+Buffer.from(user+':synthetic-test-value').toString('base64');
test('preview maps only existing Basic Auth identities to staff lookup',()=>{
  assert.equal(previewStaffEmail(basic('owner'),env),'owner@example.invalid');
  assert.equal(previewStaffEmail(basic('developer'),env),'developer@example.invalid');
  assert.equal(previewStaffEmail(basic('customer'),env),null);
  assert.equal(previewStaffEmail(basic('__proto__'),env),null);
});
test('SSO is opt-in and restricted to preview role',()=>{
  assert.equal(previewStaffEmail(basic('owner'),{}),null);
  assert.equal(previewStaffEmail(basic('owner'),{...env,STOREFRONT_DATABASE_ROLE:'storefront_test_ro'}),null);
  assert.equal(previewStaffEmail(basic('owner'),{...env,PREVIEW_STAFF_BASIC_AUTH:'0'}),null);
});
test('missing/malformed authorization or map fails closed',()=>{
  for(const h of [null,'Bearer owner','Basic !!!','Basic '+Buffer.from('owner:').toString('base64')])assert.equal(previewStaffEmail(h,env),null);
  for(const map of ['{','[]','{"owner":3}','{"owner":"invalid"}','{}'])assert.equal(previewStaffEmail(basic('owner'),{...env,PREVIEW_STAFF_MAP:map}),null);
});
