import {build} from 'esbuild';
import {mkdir,rename,cp,rm} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';

// Builds from the same Laya source; no secret or env file is part of the artifact.
await rm('dist',{recursive:true,force:true});
execFileSync(process.execPath,['tools/build.mjs'],{stdio:'inherit'});
await mkdir('dist/client',{recursive:true});
for(const file of ['index.html','app.js','app.js.map','vendor'])await rename(`dist/${file}`,`dist/client/${file}`);
await mkdir('dist/server',{recursive:true});
await build({entryPoints:['services/brain-gateway/src/worker.ts'],outfile:'dist/server/index.js',bundle:true,format:'esm',platform:'browser',target:'es2022',sourcemap:false});
await mkdir('dist/.openai',{recursive:true});
await cp('.openai/hosting.json','dist/.openai/hosting.json');
console.log('Laya client and authenticated model Worker built.');
