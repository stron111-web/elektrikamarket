'use strict';
const { readAvailableStocks } = require('../../scripts/import/pricat-store.cjs');

// Compose the importer's existing tagged SQL without executing it or copying
// its trading rules. Replace only the code-list parameter with a SQL subquery.
// Non-thenable boxes prevent the async reader from executing the nested query.
async function availabilitySql(tx, candidateCodes) {
  const codes = ['storefront-query-scope'];
  const marker = Symbol('sql-fragment');
  function compose(strings, ...values) {
    if (strings === codes) return tx`(${candidateCodes})`;
    if (!Array.isArray(strings) || !Object.hasOwn(strings, 'raw')) {
      throw new Error('Unexpected importer SQL builder call');
    }
    return {
      [marker]: true,
      query: tx(strings, ...values.map(value => value?.[marker] ? value.query : value)),
    };
  }
  const result = await readAvailableStocks(compose, codes);
  if (!result?.[marker]) throw new Error('Unexpected importer SQL reader result');
  return { query: result.query };
}

module.exports = { availabilitySql };
