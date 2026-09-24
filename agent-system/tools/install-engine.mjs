import {readFile,writeFile,mkdir,access} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
const root=path.resolve('apps/laya-client');
const lock=JSON.parse(await readFile(path.join(root,'engine-lock.json'),'utf8'));
const digest=b=>createHash('sha256').update(b).digest('hex');
for(const file of lock.files){
  const target=path.join(root,file.path);let existing;
  try{existing=await readFile(target);}catch{}
  if(existing&&digest(existing)===file.sha256){console.log(`${file.path}: verified`);continue;}
  let bytes;
  if(process.env.LAYA_REFERENCE_ROOT){bytes=await readFile(path.join(process.env.LAYA_REFERENCE_ROOT,file.path));}
  else{
    const url=`https://api.github.com/repos/${lock.referenceRepository}/contents/${file.path}?ref=${lock.referenceCommit}`;
    const headers={Accept:'application/vnd.github.raw+json','X-GitHub-Api-Version':'2022-11-28'};
    if(process.env.GITHUB_TOKEN)headers.Authorization=`Bearer ${process.env.GITHUB_TOKEN}`;
    const r=await fetch(url,{headers,signal:AbortSignal.timeout(60000)});
    if(!r.ok)throw Error(`读取锁定引擎失败 HTTP ${r.status}；可设置 LAYA_REFERENCE_ROOT 为本地参考工程目录，或使用有仓库读取权限的 GITHUB_TOKEN。`);
    bytes=Buffer.from(await r.arrayBuffer());
  }
  if(bytes.length!==file.size||digest(bytes)!==file.sha256)throw Error(`${file.path}: SHA-256 mismatch; existing bytes were preserved`);
  await mkdir(path.dirname(target),{recursive:true});await writeFile(target,bytes);console.log(`${file.path}: installed and verified`);
}
