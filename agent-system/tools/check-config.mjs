import{readFile}from'node:fs/promises';import{createHash}from'node:crypto';
const b=await readFile('packages/sim-core/defaults.json');
const actual=createHash('sha256').update(b).digest('hex');
const code=await readFile('packages/sim-core/src/config-version.ts','utf8');
if(!code.includes(actual))throw Error('Replay config hash must be updated after an explicit config/schema migration');
console.log('Replay configuration SHA-256 verified');
