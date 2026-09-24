import {createServer,type IncomingMessage,type ServerResponse} from 'node:http';
import {randomBytes,timingSafeEqual} from 'node:crypto';
import {readFile,stat,mkdir,appendFile} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {RealModelGateway,loadConfig,GatewayError} from './gateway.ts';
import {JournalSummaryGateway} from './summary.ts';
import {ContractError} from '../../../packages/contracts/src/validation.ts';

const projectRoot=resolve(fileURLToPath(new URL('../../../',import.meta.url)));
const safeEqual=(a:string,b:string)=>{const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length&&timingSafeEqual(x,y);};
const json=(response:ServerResponse,status:number,value:unknown)=>{response.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});response.end(JSON.stringify(value));};
async function body(request:IncomingMessage){let size=0;const chunks:Buffer[]=[];for await(const chunk of request){size+=chunk.length;if(size>256_000)throw new GatewayError('BODY_TOO_LARGE','请求过大',413);chunks.push(chunk);}try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new GatewayError('INVALID_JSON','请求必须为 JSON',400);}}
export function createGatewayServer(options:{gateway?:RealModelGateway;summaryGateway?:JournalSummaryGateway;staticRoot?:string;loginToken?:string}={}){
  const gateway=options.gateway??new RealModelGateway(loadConfig());
  const summaryGateway=options.summaryGateway??new JournalSummaryGateway(gateway.config);
  let loginToken=options.loginToken??randomBytes(24).toString('base64url');
  const sessions=new Map<string,number>();const staticRoot=resolve(options.staticRoot??resolve(projectRoot,'dist'));
  const authenticated=(request:IncomingMessage)=>{const token=(request.headers.cookie??'').split(';').map(s=>s.trim()).find(s=>s.startsWith('survive_session='))?.slice(16);const until=token?sessions.get(token):undefined;if(until&&until>Date.now())return true;if(token)sessions.delete(token);return false;};
  const session=(response:ServerResponse,token:string)=>{if(!loginToken||!safeEqual(token,loginToken))throw new GatewayError('AUTH_INVALID','会话令牌无效或已使用',401);loginToken='';const value=randomBytes(32).toString('base64url');sessions.set(value,Date.now()+3_600_000);response.setHeader('set-cookie',`survive_session=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=3600`);};
  const server=createServer(async(request,response)=>{
    response.setHeader('x-content-type-options','nosniff');response.setHeader('referrer-policy','no-referrer');
    try{
      // Local only. Host/origin validation prevents DNS rebinding and cross-site POSTs.
      const host=request.headers.host??'';
      if(!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host))throw new GatewayError('HOST_REJECTED','仅允许本机会话访问',403);
      if(request.headers.origin&&request.headers.origin!==`http://${host}`)throw new GatewayError('ORIGIN_REJECTED','跨来源请求被拒绝',403);
      const url=new URL(request.url??'/',`http://${host}`);
      if(request.method==='GET'&&url.searchParams.has('login')){session(response,url.searchParams.get('login')??'');response.writeHead(303,{location:'/'});response.end();return;}
      if(request.method==='GET'&&url.pathname==='/api/health'){json(response,200,{configured:gateway.configured,authenticated:authenticated(request),source:'REAL_MODEL',model:gateway.config.model,status:gateway.configured?'READY':'BLOCKED_MODEL_NOT_CONFIGURED'});return;}
      if(request.method==='POST'&&url.pathname==='/api/session'){const input=await body(request);if(!input||typeof input.token!=='string'||Object.keys(input).some(k=>k!=='token'))throw new GatewayError('AUTH_INVALID','需要一次性本机会话令牌',400);session(response,input.token);json(response,200,{authenticated:true});return;}
      if(request.method==='POST'&&['/api/decide','/api/summarize'].includes(url.pathname)){
        if(!authenticated(request))throw new GatewayError('AUTH_REQUIRED','请使用启动日志中的一次性登录链接建立本机会话',401);
        const requestBody=await body(request);const controller=new AbortController();response.on('close',()=>{if(!response.writableEnded)controller.abort();});
        const result=url.pathname==='/api/summarize'?await summaryGateway.summarize(requestBody,controller.signal):await gateway.decide(requestBody,controller.signal);json(response,200,result);return;
      }
      if(url.pathname.startsWith('/api/'))throw new GatewayError('NOT_FOUND','接口不存在',404);
      if(request.method!=='GET'&&request.method!=='HEAD')throw new GatewayError('METHOD_NOT_ALLOWED','方法不支持',405);
      let file=resolve(staticRoot,'.'+decodeURIComponent(url.pathname));
      if(file!==staticRoot&&!file.startsWith(staticRoot+sep))throw new GatewayError('NOT_FOUND','文件不存在',404);
      try{if((await stat(file)).isDirectory())file=resolve(file,'index.html');await stat(file);}catch{if(extname(url.pathname))throw new GatewayError('NOT_FOUND','文件不存在',404);file=resolve(staticRoot,'index.html');}
      let data:Buffer;try{data=await readFile(file);}catch{throw new GatewayError('BUILD_REQUIRED','前端尚未构建；请先 npm run build',503);}
      const mime:Record<string,string>={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml','.wasm':'application/wasm','.woff2':'font/woff2'};
      response.writeHead(200,{'content-type':mime[extname(file)]??'application/octet-stream','cache-control':'no-cache'});response.end(request.method==='HEAD'?undefined:data);
    }catch(error){
      const safe=error instanceof GatewayError?error:error instanceof ContractError?new GatewayError('CONTRACT_INVALID',error.message,400):new GatewayError('INTERNAL_ERROR','服务未能处理请求',500);
      if(!response.headersSent&&!response.destroyed)json(response,safe.status,{error:{code:safe.code,message:safe.message},message:safe.message});
    }
  });
  return {server,loginToken,gateway};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const evidenceRoot=resolve(projectRoot,'evidence');await mkdir(evidenceRoot,{recursive:true});
  const gateway=new RealModelGateway(loadConfig(),{audit:record=>{void appendFile(resolve(evidenceRoot,'gateway-audit.jsonl'),JSON.stringify(record)+'\n').catch(()=>{console.error('审计记录写入失败');});}});
  const {server,loginToken}=createGatewayServer({gateway});
  const port=Number(process.env.SURVIVE_PORT??8787);if(!Number.isInteger(port)||port<1024||port>65535)throw new Error('Invalid local port');
  server.listen(port,'127.0.0.1',()=>{console.log(`观察者：http://127.0.0.1:${port}/?login=${loginToken}`);console.log(`真实模型：${gateway.configured?'已配置（仍须真实验收）':'BLOCKED：缺少本项目 SURVIVE_MODEL_API_KEY'}`);});
}
