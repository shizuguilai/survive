import {WECHAT_GATEWAY_URL} from './platform-config.ts';
let sessionCookie='';
export async function gatewayRequest(path:string,options:{method?:'GET'|'POST';body?:unknown;signal?:AbortSignal}={}):Promise<{ok:boolean;status:number;json():Promise<any>}>{
  const wx=(globalThis as any).wx;
  if(!wx?.request)return fetch(path,{method:options.method??'GET',headers:{'Content-Type':'application/json'},credentials:'same-origin',body:options.body===undefined?undefined:JSON.stringify(options.body),signal:options.signal});
  if(!/^https:\/\/[^/]+/.test(WECHAT_GATEWAY_URL))throw Error('微信版尚未配置 HTTPS 模型网关地址');
  return new Promise((resolve,reject)=>{
    if(options.signal?.aborted){reject(Error('请求已取消'));return;}
    let task:any;const aborted=()=>{task?.abort();reject(Error('请求已取消'));};
    options.signal?.addEventListener('abort',aborted,{once:true});
    task=wx.request({url:WECHAT_GATEWAY_URL.replace(/\/$/,'')+path,method:options.method??'GET',data:options.body,
      header:{'Content-Type':'application/json',...(sessionCookie?{Cookie:sessionCookie}:{})},
      success:(r:any)=>{const cookie=r.header?.['Set-Cookie']??r.header?.['set-cookie'];if(cookie)sessionCookie=String(cookie).split(';')[0];resolve({ok:r.statusCode>=200&&r.statusCode<300,status:r.statusCode,json:async()=>typeof r.data==='string'?JSON.parse(r.data):r.data});},
      fail:()=>reject(Error('模型网关网络连接失败')),
      complete:()=>options.signal?.removeEventListener('abort',aborted)
    });
  });
}
