import { spawn } from 'node:child_process';
import type { ModelConfig } from '../src/lib/model-routing';

/** Extract only the root answer string. Never expose JSON, reasoning or tool output. */
export class AnswerDecoder {
  private depth = 0;
  private quoted = false;
  private role: 'key' | 'answer' | 'other' = 'other';
  private key = '';
  private value = '';
  private last = '';
  private escape = false;
  private unicode: string | undefined;
  private pendingHigh = '';
  private done = false;
  push(chunk: string): string {
    let output = '';
    const append = (c: string) => {
      if (this.role === 'key') this.value += c;
      if (this.role !== 'answer') return;
      if (this.pendingHigh) { output += this.pendingHigh + c; this.pendingHigh = ''; }
      else if (c.length === 1 && c.charCodeAt(0) >= 0xd800 && c.charCodeAt(0) <= 0xdbff) this.pendingHigh = c;
      else output += c;
    };
    for (const c of chunk) {
      if (this.done) break;
      if (this.quoted) {
        if (this.unicode !== undefined) {
          if (!/[0-9a-f]/i.test(c)) throw new Error('Invalid JSON escape');
          this.unicode += c;
          if (this.unicode.length === 4) { append(String.fromCharCode(parseInt(this.unicode, 16))); this.unicode = undefined; }
        } else if (this.escape) {
          this.escape = false;
          if (c === 'u') this.unicode = '';
          else { const map: Record<string, string> = {'"':'"', '\\':'\\', '/':'/', n:'\n', r:'\r', t:'\t', b:'\b', f:'\f'}; if (!(c in map)) throw new Error('Invalid JSON escape'); append(map[c]); }
        } else if (c === '\\') this.escape = true;
        else if (c === '"') {
          this.quoted = false;
          if (this.role === 'key') this.key = this.value;
          if (this.role === 'answer') this.done = true;
          this.last = '"';
        } else append(c);
      } else if (c === '"') {
        this.quoted = true; this.value = '';
        this.role = this.depth === 1 && ['{', ','].includes(this.last) ? 'key' : this.depth === 1 && this.last === ':' && this.key === 'answer' ? 'answer' : 'other';
      } else if (!/\s/.test(c)) {
        if (c === '{' || c === '[') this.depth++;
        if (c === '}' || c === ']') this.depth--;
        this.last = c;
      }
    }
    return output;
  }
}

export interface CodexTurnOptions {
  binary: string; cwd: string; config: ModelConfig; prompt: string; schema: unknown;
  searchable: boolean; timeoutMs: number; signal?: AbortSignal;
  onDelta: (delta: string) => void;
  onTrace: (line: string) => void;
}
export type CodexTurnRunner = (options: CodexTurnOptions) => Promise<{ raw: string; trace: string }>;

/** Per-request ephemeral app-server. Uses the same binary/login as model discovery. */
export const runCodexTurn: CodexTurnRunner = async options => {
  options.signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const child = spawn(options.binary, ['app-server', '--listen', 'stdio://'], { cwd: options.cwd, stdio: ['pipe','pipe','pipe'], windowsHide: true });
    let buffer = '', bytes = 0, settled = false, threadId = '', turnId = '', final = '', trace = '';
    const items = new Map<string, { text: string; decoder: AnswerDecoder; phase?: string }>();
    const send = (message: object) => { if (!settled) child.stdin.write(JSON.stringify(message) + '\n'); };
    const record = (event: object) => { const line = JSON.stringify(event) + '\n'; trace += line; options.onTrace(line); };
    const finish = (error?: Error) => {
      if (settled) return; settled = true; clearTimeout(timer); options.signal?.removeEventListener('abort', abort);
      child.stdin.end(); child.kill('SIGTERM');
      const force = setTimeout(() => child.kill('SIGKILL'), 500); force.unref(); child.once('close', () => clearTimeout(force));
      if (error) reject(error); else resolve({ raw: final, trace });
    };
    const abort = () => finish(new Error('请求已中断'));
    const timer = setTimeout(() => finish(Object.assign(new Error('Codex回答超时'), {code:'ETIMEDOUT'})), options.timeoutMs);
    options.signal?.addEventListener('abort', abort, {once:true});
    if (options.signal?.aborted) { abort(); return; }
    child.on('error', () => finish(new Error('无法启动Codex流式接口')));
    child.on('close', () => { if (!settled) finish(new Error('Codex流式连接提前结束')); });
    child.stdin.on('error', () => finish(new Error('Codex流式连接中断')));
    const count = (n: number) => { bytes += n; if (bytes > 4 * 1024 * 1024) finish(new Error('Codex响应超过限制')); };
    child.stderr.on('data', (chunk: Buffer) => count(chunk.length));
    const consume = (m: any) => {
      if (m.id != null) {
        if (m.method) { send({id:m.id,error:{code:-32601,message:'Interactive tools are unavailable'}}); throw new Error('本轮要求不支持的交互工具'); }
        if (m.error) throw new Error('Codex拒绝流式请求');
        if (m.id === 0) {
          send({method:'initialized',params:{}});
          send({id:1,method:'thread/start',params:{model:options.config.model,cwd:options.cwd,approvalPolicy:'never',sandbox:'read-only',ephemeral:true,
            baseInstructions:'你是阅读助手，只回答当前阅读问题。不要操作本机文件、执行命令或使用与阅读无关的工具。',
            config:{web_search: options.searchable ? 'live' : 'disabled', project_doc_max_bytes:0, 'features.shell_tool':false}}});
        } else if (m.id === 1) {
          threadId = m.result?.thread?.id; if (!threadId) throw new Error('Codex线程格式不兼容');
          send({id:2,method:'turn/start',params:{threadId,model:options.config.model,effort:options.config.reasoningEffort,input:[{type:'text',text:options.prompt,text_elements:[]}],outputSchema:options.schema}});
        } else if (m.id === 2) {
          const id = m.result?.turn?.id; if (!id || (turnId && turnId !== id)) throw new Error('Codex轮次不匹配'); turnId = id;
        }
        return;
      }
      const p = m.params;
      if (!p || p.threadId !== threadId) return;
      if (m.method === 'turn/started') { turnId = p.turn.id; record({type:'turn.started'}); return; }
      if (p.turnId && p.turnId !== turnId) return;
      if (m.method === 'error' && !p.willRetry) throw new Error('Codex本轮执行失败');
      if (m.method === 'item/started' && p.item?.type === 'agentMessage') items.set(p.item.id,{text:'',decoder:new AnswerDecoder(),phase:p.item.phase});
      if (m.method === 'item/agentMessage/delta' && typeof p.delta === 'string') {
        const item = items.get(p.itemId);
        if (item && item.phase !== 'commentary') { item.text += p.delta; if(item.text.length > 256*1024) throw new Error('回答超过限制'); const delta=item.decoder.push(p.delta); if(delta) options.onDelta(delta); }
      }
      if (['item/started','item/completed'].includes(m.method) && p.item?.type === 'webSearch') {
        record({type:m.method === 'item/started'?'item.started':'item.completed',item:{...p.item,type:'web_search'}});
      }
      if (m.method === 'item/completed' && p.item?.type === 'agentMessage' && p.item.phase !== 'commentary') {
        final = p.item.text;
        const item = items.get(p.item.id);
        // Some runtimes deliver only a completed message; do not simulate typing.
        if (!item?.text && typeof final === 'string') { const delta=new AnswerDecoder().push(final); if(delta)options.onDelta(delta); }
      }
      if (m.method === 'turn/completed' && p.turn?.id === turnId) {
        if (p.turn.status !== 'completed' || !final) throw new Error('Codex未完成本轮回答');
        record({type:'turn.completed'}); finish();
      }
    };
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      if (settled) return; count(Buffer.byteLength(chunk)); buffer += chunk;
      let end: number;
      while (!settled && (end=buffer.indexOf('\n')) >= 0) {
        const line=buffer.slice(0,end); buffer=buffer.slice(end+1); if(!line.trim())continue;
        try { consume(JSON.parse(line)); } catch(error) { finish(error instanceof Error ? error : new Error('Codex协议格式不兼容')); }
      }
    });
    send({id:0,method:'initialize',params:{clientInfo:{name:'got_it',title:'Got-it',version:'0.1.0'}}});
  });
};
