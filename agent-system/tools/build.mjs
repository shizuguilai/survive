import {build} from 'esbuild';
import {mkdir,cp,writeFile,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';

execFileSync(process.execPath,['node_modules/typescript/bin/tsc','--noEmit'],{stdio:'inherit'});
await mkdir('dist',{recursive:true});
await cp('apps/laya-client/vendor','dist/vendor',{recursive:true});
await build({entryPoints:['apps/laya-client/src/web.ts'],outfile:'dist/app.js',bundle:true,format:'iife',target:'es2022',platform:'browser',sourcemap:true});
await writeFile('dist/index.html',`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no"><title>Survive · 独立心智观察场</title><style>html,body{margin:0;width:100%;height:100%;background:#f4f2e9;overflow:hidden}canvas{touch-action:none}</style></head><body><script src="vendor/laya.core.js"></script><script src="vendor/laya.d3.js"></script><script src="vendor/laya.webgl_2D.js"></script><script src="vendor/laya.webgl_3D.js"></script><script src="app.js"></script></body></html>`);
const report={status:'passed',kind:'web-bundle',engineVersion:'3.3.12',node:process.version,layaIdeBuild:'blocked_missing_ide',wechatBuild:'not_run',appSha256:createHash('sha256').update(await readFile('dist/app.js')).digest('hex')};
await mkdir('evidence',{recursive:true});await writeFile('evidence/web-build.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
