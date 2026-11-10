'use strict';
// Owner-only CLI, not an HTTP route. Never print provider payload or credentials.
const {validatePair}=require('./dadata-core.cjs');
validatePair({apiKey:process.env.DADATA_API_KEY,secretKey:process.env.DADATA_SECRET_KEY})
 .then(result=>{console.log(JSON.stringify(result));process.exitCode=result.accepted?0:1;})
 .catch(()=>{console.log('{"accepted":false,"reason":"probe_failed"}');process.exitCode=1;});
