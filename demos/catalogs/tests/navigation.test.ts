import { test } from 'node:test';
import assert from 'node:assert/strict';
import { href, roots, trail } from '../lib/navigation.ts';
import type { Category } from '../lib/types';
test('variant links preserve category, search, page and product view with URL escaping', () => {
  for (const v of [1,2,3] as const) {
    const url = new URL(href(v, 'кабель&провод', 'ВВГ 3×2,5', 3, true), 'http://demo');
    assert.equal(url.pathname, `/demo/catalog-v${v}`);
    assert.equal(url.searchParams.get('category'), 'кабель&провод');
    assert.equal(url.searchParams.get('q'), 'ВВГ 3×2,5');
    assert.equal(url.searchParams.get('page'), '3');
    assert.equal(url.searchParams.get('view'), 'products');
  }
});
test('navigation tolerates an orphan and stops at a cycle without changing source categories', () => {
  const categories: Category[] = [{id:1,name:'a',slug:'a',parentId:2,count:1},{id:2,name:'b',slug:'b',parentId:1,count:1},{id:3,name:'c',slug:'c',parentId:99,count:1}];
  const original=JSON.stringify(categories);
  assert.deepEqual(roots(categories).map(c=>c.id),[3]);
  assert.equal(trail(categories,categories[0]).length,2);
  assert.equal(JSON.stringify(categories),original);
});
