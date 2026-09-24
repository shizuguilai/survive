import {existsSync} from 'node:fs';
// A registered cloud checkout includes hosting identity; local builds stay flat.
if(existsSync('.openai/hosting.json'))await import('./build-site.mjs');
else await import('./build.mjs');
