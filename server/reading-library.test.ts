// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, writeFile, mkdir, rename, readFile, readdir, rm, symlink, unlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { once } from "node:events";
import { get as httpGet } from "node:http";
import { ReadingLibrary } from "./reading-library";
import { LibraryError, pickerError } from "./file-picker";
import { createApp } from "./index";
import { readDocumentFile, workspaceToReadingDocument } from "../src/lib/reading-document-core";
import { createInitialWorkspace } from "../src/sample";
const dirs: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(dirs.splice(0).map(d => rm(d, { recursive:true, force:true }))); });
async function setup() {
  const dir = await mkdtemp(join(tmpdir(), "got-it-test-")); dirs.push(dir);
  const source = join(dir, "中文 报告.md"); await writeFile(source, "# 测试文章\n\n旧内容与选区。\n");
  let path: string | null = source, time = 1000;
  const library = new ReadingLibrary(join(dir, "data"), async () => path, () => time);
  return { dir, source, library, choosePath: (p: string|null) => { path=p; }, expire: () => { time+=400000; } };
}
async function add(l: ReadingLibrary, key="test") {
  const f = (await l.choose())!;
  const w = await readDocumentFile({ name: f.filename, size: Buffer.byteLength(f.content), text: async()=>f.content });
  return l.add(w,key,f.selectionId);
}
async function saveFixture(l: ReadingLibrary, e: Awaited<ReturnType<typeof add>>) {
  const w=e.workspace;
  w.inquiries=[{id:"i",intent:"explain",anchor:{documentId:w.document.id,blockId:"block",quote:"旧内容",prefix:"",suffix:"",headingPath:[],start:0,end:3,matchStatus:"matched",textVersion:2},question:"解释",understanding:"",status:"answering",createdAt:"2026",updatedAt:"2026",messages:[{id:"m",role:"assistant",content:"已收到的部分",createdAt:"2026",completion:"provisional",evidenceStatus:"partial"}]}];
  Object.assign(w,{apiKey:"SECRET",sourcePath:"PRIVATE"});
  return l.save(e.id,e.version,e.revisionId,w,{ratio:.5,blockId:"block",offset:10});
}
describe("disk reading library",()=>{
  it("persists separate paths, detects duplicate path, restores focus and interrupted safe records after restart",async()=>{
    const s=await setup(); let a=await add(s.library); a=await saveFixture(s.library,a);
    expect(a.workspace.inquiries[0].messages[0].completion).toBe("interrupted");
    expect(JSON.stringify(a.workspace)).not.toContain("SECRET"); expect(JSON.stringify(a.workspace)).not.toContain("PRIVATE");
    const duplicate=await add(s.library,"again"); expect(duplicate.id).toBe(a.id);
    const other=join(s.dir,"other"); await mkdir(other); const otherFile=join(other,"中文 报告.md"); await writeFile(otherFile,a.workspace.document.markdown); s.choosePath(otherFile);
    const b=await add(s.library,"b"); expect(b.id).not.toBe(a.id); await s.library.activate(a.id);
    const restored=new ReadingLibrary(s.library.dir); const list=await restored.list(); expect(list.entries).toHaveLength(2); expect(list.activeId).toBe(a.id);
    expect((await restored.get(a.id)).position.ratio).toBe(.5);
    expect(await readFile(s.source,"utf8")).toBe(a.workspace.document.markdown);
  });
  it("rejects stale writes and wrong document graphs without losing committed data",async()=>{
    const {library:l}=await setup(); const e=await add(l); await saveFixture(l,e);
    await expect(l.save(e.id,e.version,e.revisionId,e.workspace,{})).rejects.toMatchObject({status:409});
    const fresh=await l.get(e.id); fresh.workspace.inquiries[0].anchor.documentId="other";
    await expect(l.save(e.id,fresh.version,e.revisionId,fresh.workspace,{})).rejects.toThrow(/关联/);
    expect((await l.get(e.id)).workspace.inquiries[0].anchor.documentId).toBe(e.workspace.document.id);
  });
  it("relinks moved files; preserves old reading revision on explicit update and rejects changing confirmations",async()=>{
    const s=await setup(); let e=await saveFixture(s.library,await add(s.library));
    const moved=join(s.dir,"移动.md"); await rename(s.source,moved); expect((await s.library.check(e.id)).status).toBe("missing");
    s.choosePath(moved); const chosen=(await s.library.choose())!; const linked=await s.library.relink(e.id,chosen.selectionId,e.version); e=linked.entry;
    expect(linked.check.status).toBe("available"); expect(e.workspace.inquiries).toHaveLength(1);
    await writeFile(moved,"# 新原文\n\n新内容。"); let check=await s.library.check(e.id); expect(check.status).toBe("changed");
    await writeFile(moved,"# 再次改变\n\n不同内容。"); await expect(s.library.updateSource(e.id,check.candidateId!,e.version)).rejects.toThrow(/再次变化/);
    check=await s.library.check(e.id); e=await s.library.updateSource(e.id,check.candidateId!,e.version);
    expect(e.history).toHaveLength(1); expect(e.history[0].workspace.inquiries).toHaveLength(1); expect(e.workspace.inquiries).toHaveLength(0);
    expect(workspaceToReadingDocument(e.history[0].workspace)).not.toContain(moved);
  });
  it("does not merge an already associated source, handles different relink content and expired selections",async()=>{
    const s=await setup(); const a=await add(s.library); const bPath=join(s.dir,"b.md"); await writeFile(bPath,"# 第二篇"); s.choosePath(bPath);
    const b=await add(s.library,"b"); let f=(await s.library.choose())!;
    await expect(s.library.relink(a.id,f.selectionId,a.version)).rejects.toThrow(/另一阅读条目/);
    const cPath=join(s.dir,"c.md"); await writeFile(cPath,"# 第三篇"); s.choosePath(cPath); f=(await s.library.choose())!;
    const result=await s.library.relink(a.id,f.selectionId,a.version); expect(result.check.status).toBe("changed"); expect((await s.library.get(a.id)).source?.path).toBe(s.source);
    f=(await s.library.choose())!; s.expire(); await expect(s.library.relink(a.id,f.selectionId,a.version)).rejects.toThrow(/过期/); expect((await s.library.get(b.id)).workspace.document.filename).toBe("b.md");
  });
  it("blocks changed symlink targets and never interprets arbitrary IDs as paths",async()=>{
    const s=await setup(); const link=join(s.dir,"link.md"); await symlink(s.source,link); s.choosePath(link); const e=await add(s.library);
    const other=join(s.dir,"other.md"); await writeFile(other,"# unrelated"); await unlink(link); await symlink(other,link);
    expect((await s.library.check(e.id)).status).toBe("reselect"); await expect(s.library.get("../../secret")).rejects.toMatchObject({status:404});
  });
  it("imports legacy safely and idempotently; does not trust injected source paths or migrate demos",async()=>{
    const s=await setup(); const e=await add(s.library); const w=e.workspace;
    Object.assign(w,{source:{path:s.source},token:"SECRET"});
    const migrated=await s.library.add(w,"migration:key"); const retry=await s.library.add(w,"migration:key");
    expect(retry.id).toBe(migrated.id); expect(migrated.source).toBeNull(); expect(JSON.stringify(migrated)).not.toContain("SECRET");
    await expect(s.library.add(createInitialWorkspace(),"demo")).rejects.toThrow(/示例/);
    const focus=join(s.dir,"backup.focus"); await writeFile(focus,workspaceToReadingDocument(w)); s.choosePath(focus);
    expect((await add(s.library,"backup")).source).toBeNull();
  });
  it("isolates corrupt entries and ignores incomplete/orphaned writes",async()=>{
    const s=await setup(); const a=await add(s.library); const b=await s.library.add(a.workspace,"copy");
    const aDir=join(s.library.dir,"entries",a.id); await writeFile(join(aDir,"unfinished.tmp"),"partial"); await writeFile(join(aDir,"999-orphan.json"),"partial");
    expect((await s.library.get(a.id)).version).toBe(1);
    await writeFile(join(s.library.dir,"entries",b.id,"CURRENT"),"broken");
    const list=await s.library.list(); expect(list.entries).toHaveLength(1); expect(list.warnings).toHaveLength(1);
    await s.library.save(a.id,a.version,a.revisionId,a.workspace,{ratio:.3}); expect(await readdir(aDir)).not.toContain("unfinished.tmp");
  });
  it("keeps previous commit on failed writes",async()=>{
    const s=await setup(); const e=await add(s.library);
    const spy=vi.spyOn(s.library as unknown as {atomic:(p:string,d:string)=>Promise<void>},"atomic").mockRejectedValue(new Error("ENOSPC"));
    await expect(s.library.save(e.id,e.version,e.revisionId,e.workspace,{ratio:.8})).rejects.toThrow(); spy.mockRestore();
    expect((await s.library.get(e.id)).version).toBe(e.version);
  });
  it("checks cancellation, one-time selection, empty/large files, and sanitizes picker errors",async()=>{
    const s=await setup(); s.choosePath(null); expect(await s.library.choose()).toBeNull(); s.choosePath(s.source);
    const f=(await s.library.choose())!; const w=await readDocumentFile({name:f.filename,size:1,text:async()=>f.content}); await s.library.add(w,"one",f.selectionId);
    await expect(s.library.add(w,"two",f.selectionId)).rejects.toThrow(/过期/);
    await writeFile(s.source,""); await expect(s.library.choose()).rejects.toThrow(/空/);
    await writeFile(s.source,"a".repeat(20*1024*1024+1)); await expect(s.library.choose()).rejects.toThrow(/20MiB/);
    expect(pickerError({stderr:"cancel (-128)"})).toBeNull(); expect(pickerError({stderr:"private-path permission denied"})?.message).not.toContain("private-path"); expect(pickerError({killed:true})?.status).toBe(408);
  });
  it("distinguishes permission failures from missing files (controlled fixture)",async()=>{
    const s=await setup(); const e=await add(s.library);
    vi.spyOn(s.library as unknown as {readSource:()=>Promise<unknown>},"readSource").mockRejectedValue(Object.assign(new Error(),{code:"EACCES"}));
    expect((await s.library.check(e.id)).status).toBe("permission");
  });
});
describe("local library API boundary",()=>{
  it("rejects hostile origins/hosts and sessions before reading or opening a chooser; supports same-origin library calls",async()=>{
    const s=await setup(); const picker=vi.spyOn(s.library,"choose");
    const server=createApp({library:s.library}).listen(0,"127.0.0.1"); await once(server,"listening");
    const base=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
    try {
      for(const origin of ["https://evil.test","null"]) expect((await fetch(`${base}/api/library/session`,{method:"POST",headers:{Origin:origin,"Content-Type":"application/json"},body:"{}"})).status).toBe(403);
      expect(await new Promise<number|undefined>(resolve => { httpGet(`${base}/api/library`, {headers:{Host:"evil.test"}}, r => { r.resume(); resolve(r.statusCode); }); })).toBe(403);
      expect((await fetch(`${base}/api/library/choose`,{method:"POST",headers:{"Content-Type":"application/json"},body:"{}"})).status).toBe(401); expect(picker).not.toHaveBeenCalled();
      const session=await fetch(`${base}/api/library/session`,{method:"POST",headers:{"Content-Type":"application/json",Origin:base},body:"{}"}); const {token}=await session.json();
      const headers={"X-Got-It-Session":token,"Content-Type":"application/json",Origin:base};
      const addResult=await fetch(`${base}/api/library/choose`,{method:"POST",headers,body:"{}"}); expect(addResult.ok).toBe(true);
      expect((await fetch(`${base}/api/library`,{headers})).ok).toBe(true);
      expect((await fetch(`${base}/api/library/entries`,{method:"POST",headers,body:JSON.stringify({workspace:{sourcePath:"/etc/passwd"},creationKey:"bad"})})).status).toBe(400);
      expect((await fetch(`${base}/api/library/entries`,{method:"POST",headers,body:JSON.stringify({payload:"a".repeat(24*1024*1024)})})).status).toBe(413);
      expect((await fetch(`${base}/api/library/entries/not-an-id`,{headers})).status).toBe(404);
      expect((await fetch(`${base}/api/library`,{headers:{...headers,Origin:"http://127.0.0.1:5173"}})).ok).toBe(true);
    } finally { server.close(); await once(server,"close"); }
  });
});
