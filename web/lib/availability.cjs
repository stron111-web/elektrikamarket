'use strict';
// Compatibility oracle for equivalence tests; public requests use the stored snapshot.
const {availableStocksQuery}=require('../../scripts/import/pricat-store.cjs');
module.exports={availabilitySql:availableStocksQuery};
