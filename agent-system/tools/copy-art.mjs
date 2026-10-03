import {cp,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';

// Small source chunks preserve the original image bytes across transfer limits.
export async function copyArt(destination){
  const source=new URL('../apps/laya-client/assets/',import.meta.url);
  const manifest=JSON.parse(await readFile(new URL('art-parts/manifest.json',source),'utf8'));
  await cp(new URL('art/',source),destination,{recursive:true});
  for(const image of manifest){
    if(!/^[a-z-]+\.png$/.test(image.name)||image.parts.some(part=>!/^[-a-z.0-9]+\.part$/.test(part)))throw new Error('Invalid art manifest path');
    const bytes=Buffer.concat(await Promise.all(image.parts.map(part=>readFile(new URL(`art-parts/${part}`,source)))));
    if(bytes.length!==image.bytes||createHash('sha256').update(bytes).digest('hex')!==image.sha256)throw new Error(`Art checksum mismatch: ${image.name}`);
    await writeFile(`${destination}/${image.name}`,bytes);
  }
}
