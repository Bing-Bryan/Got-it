import { resolveCodexBinary } from "./codex-runtime";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { copyModelConfig, type CodexModel } from "../src/lib/model-routing";

export function parseModelPage(value: unknown): { models: CodexModel[]; nextCursor: string | null } {
  const page = value as { data?: unknown[]; nextCursor?: unknown } | null;
  if (!page || !Array.isArray(page.data) || (page.nextCursor != null && typeof page.nextCursor !== "string")) throw new Error("Codex模型列表格式不兼容");
  const models: CodexModel[] = [];
  for (const item of page.data) {
    if (!item || typeof item !== "object") continue;
    const v = item as Record<string, any>;
    if (v.hidden === true || typeof v.displayName !== "string" || !Array.isArray(v.supportedReasoningEfforts)) continue;
    const efforts = v.supportedReasoningEfforts.filter((e: any) => copyModelConfig({model:v.model,reasoningEffort:e?.reasoningEffort})).map((e: any) => ({reasoningEffort:e.reasoningEffort,description:typeof e.description === "string" ? e.description.slice(0,500) : ""}));
    if (!efforts.length || !efforts.some((e: any)=>e.reasoningEffort === v.defaultReasoningEffort)) continue;
    const inputModalities = v.inputModalities === undefined ? undefined : Array.isArray(v.inputModalities) ? [...new Set(v.inputModalities.filter((m: unknown) => m === 'text' || m === 'image'))] as Array<'text' | 'image'> : [];
    models.push({model:v.model,displayName:v.displayName.slice(0,200),description:typeof v.description === "string" ? v.description.slice(0,1000) : "",defaultReasoningEffort:v.defaultReasoningEffort,supportedReasoningEfforts:efforts,isDefault:v.isDefault === true,...(inputModalities === undefined ? {} : {inputModalities})});
  }
  return { models, nextCursor: page.nextCursor as string | null ?? null };
}

/** Only initialize and model/list are called: no thread, turn or credential reads. */
export async function readCodexModels(binary = resolveCodexBinary(process.env.CODEX_CLI_PATH), timeoutMs = 15_000): Promise<CodexModel[]> {
  const cwd = await mkdtemp(join(tmpdir(), "got-it-models-"));
  try {
    return await new Promise<CodexModel[]>((resolve,reject) => {
      const child = spawn(binary,["app-server","--listen","stdio://"],{cwd,stdio:["pipe","pipe","pipe"],windowsHide:true});
      let buffer="", bytes=0, nextId=1, expectedId=0, settled=false;
      const models: CodexModel[]=[]; const cursors=new Set<string>();
      const fail = (error: Error) => finish(error);
      const timer = setTimeout(()=>fail(new Error("读取Codex模型列表超时，请重试")),timeoutMs);
      const finish = (error?: Error) => {
        if(settled)return;settled=true;clearTimeout(timer);
        child.stdin.end();child.kill("SIGTERM");
        const killTimer=setTimeout(()=>child.kill("SIGKILL"),500);killTimer.unref();
        child.once("close",()=>clearTimeout(killTimer));
        if(error)reject(error);else resolve([...new Map(models.map(m=>[m.model,m])).values()]);
      };
      const send = (value: object) => child.stdin.write(JSON.stringify(value)+"\n");
      child.stdin.on("error",()=>fail(new Error("Codex模型接口连接已中断")));
      child.on("error",()=>fail(new Error("无法启动本机Codex模型接口")));
      child.on("close",()=>{if(!settled)fail(new Error("Codex模型接口提前结束"));});
      child.stderr.on("data",(chunk:Buffer)=>{bytes+=chunk.length;if(bytes>2*1024*1024)fail(new Error("Codex模型列表响应超限"));});
      child.stdout.setEncoding("utf8");
      child.stdout.on("data",(chunk:string)=>{
        if(settled)return;bytes+=Buffer.byteLength(chunk);buffer+=chunk;
        if(bytes>2*1024*1024){fail(new Error("Codex模型列表响应超限"));return;}
        let end:number;
        while(!settled && (end=buffer.indexOf("\n"))>=0){
          const line=buffer.slice(0,end);buffer=buffer.slice(end+1);if(!line.trim())continue;
          try {
            const message=JSON.parse(line);
            if(message.id !== expectedId)continue;
            if(message.error)throw new Error("Codex拒绝读取模型列表，请检查本机连接后重试");
            if(expectedId===0){
              send({method:"initialized",params:{}});
              expectedId=nextId++;send({id:expectedId,method:"model/list",params:{limit:100,includeHidden:false}});
            }else{
              const page=parseModelPage(message.result);models.push(...page.models);
              if(page.nextCursor){
                if(cursors.has(page.nextCursor)||cursors.size>=99)throw new Error("Codex模型分页异常");
                cursors.add(page.nextCursor);expectedId=nextId++;
                send({id:expectedId,method:"model/list",params:{cursor:page.nextCursor,limit:100,includeHidden:false}});
              }else {if(!models.length)throw new Error("Codex当前没有返回可选模型");finish();}
            }
          }catch(error){fail(error instanceof Error?error:new Error("Codex模型列表格式不兼容"));}
        }
      });
      send({id:0,method:"initialize",params:{clientInfo:{name:"got_it",title:"Got-it",version:"0.1.0"}}});
    });
  }finally{await rm(cwd,{recursive:true,force:true});}
}
