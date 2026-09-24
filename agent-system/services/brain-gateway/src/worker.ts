import {GatewayError,loadConfig,RealModelGateway} from './gateway.ts';
import {ContractError} from '../../../packages/contracts/src/validation.ts';

export type WorkerEnv={SURVIVE_MODEL_API_KEY?:string;SURVIVE_MODEL_NAME?:string;SURVIVE_MODEL_BASE_URL?:string;ASSETS:{fetch(request:Request):Promise<Response>}};
const instances=new WeakMap<object,RealModelGateway>();
function gatewayFor(env:WorkerEnv):RealModelGateway{
  let gateway=instances.get(env);
  if(!gateway){
    gateway=new RealModelGateway(loadConfig({SURVIVE_MODEL_API_KEY:env.SURVIVE_MODEL_API_KEY,SURVIVE_MODEL_NAME:env.SURVIVE_MODEL_NAME,SURVIVE_MODEL_BASE_URL:env.SURVIVE_MODEL_BASE_URL}),{
      audit:({decision:privateDecision,...metadata})=>{console.info(JSON.stringify({event:'model_decision',...metadata}));}
    });
    instances.set(env,gateway);
  }
  return gateway;
}
function json(value:unknown,status=200):Response{return Response.json(value,{status,headers:{'cache-control':'no-store','x-content-type-options':'nosniff'}});}
async function readJSON(request:Request):Promise<unknown>{
  if(!request.headers.get('content-type')?.includes('application/json'))throw new GatewayError('CONTENT_TYPE','请提交 JSON 决策请求',415);
  const reader=request.body?.getReader();if(!reader)throw new GatewayError('INVALID_REQUEST','缺少请求内容',400);
  const decoder=new TextDecoder();let bytes=0,text='';
  try{for(;;){const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>256_000){await reader.cancel();throw new GatewayError('BODY_TOO_LARGE','决策上下文超过大小限制',413);}text+=decoder.decode(value,{stream:true});}text+=decoder.decode();}
  finally{reader.releaseLock();}
  try{return JSON.parse(text);}catch{throw new GatewayError('INVALID_JSON','请求必须是完整 JSON',400);}
}
/** Private Sites dispatcher owns authentication and strips/replaces identity headers.
 * No browser API key, local gateway token, anonymous access, or fallback decisions.
 * Request caches are per isolate; the simulation owns the atomic decision barrier.
 */
export default {
  async fetch(request:Request,env:WorkerEnv):Promise<Response>{
    const url=new URL(request.url);
    if(!url.pathname.startsWith('/api/')){
      if(request.method!=='GET'&&request.method!=='HEAD')return json({error:'METHOD_NOT_ALLOWED'},405);
      return env.ASSETS.fetch(request);
    }
    const authenticated=Boolean(request.headers.get('oai-authenticated-user-id')&&request.headers.get('oai-authenticated-user-email'));
    try{
      const gateway=gatewayFor(env);
      if(url.pathname==='/api/health'&&request.method==='GET')return json({configured:gateway.configured,authenticated,accessMode:'hosted',source:'REAL_MODEL',model:gateway.config.model,status:gateway.configured?'CONFIGURED':'UNCONFIGURED'});
      if(!authenticated)return json({error:'AUTH_REQUIRED',message:'请用本站所属账号登录后再启动真实模型。'},401);
      if(url.pathname!=='/api/decide')return json({error:'NOT_FOUND'},404);
      if(request.method!=='POST')return json({error:'METHOD_NOT_ALLOWED'},405);
      if(request.headers.get('origin')!==url.origin)return json({error:'ORIGIN_REJECTED',message:'模型请求必须来自本站。'},403);
      return json(await gateway.decide(await readJSON(request),request.signal));
    }catch(error){
      if(error instanceof GatewayError)return json({error:error.code,message:error.message},error.status);
      if(error instanceof ContractError)return json({error:'INVALID_CONTRACT',message:'决策请求不符合独立居民上下文契约。'},400);
      return json({error:'GATEWAY_ERROR',message:'模型网关暂时失败；世界保持暂停。'},500);
    }
  }
};
