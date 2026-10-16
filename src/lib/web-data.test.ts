import { createInitialWorkspace } from "../sample";
import { webWorkspace } from "../test-support/web";
import { describe, expect, it } from "vitest";
import { copyWebDocument, safeWebUrl } from "./web-data";
import { restoreWorkspace, sanitizeWorkspace } from "./storage";
import { parseReadingDocument, workspaceToReadingDocument } from "./reading-document-core";
import { canonical, readingContent, sameOriginal } from "./reading-recovery";
import { hasRecoveryDifference } from "./recovery-diff";


describe("web snapshot contract", () => {
  it("keeps source, media failures and fragment mapping while removing runtime credentials", () => {
    const w = webWorkspace();
    Object.assign(w.document, { apiToken: "private-runtime" });
    Object.assign(w.document.kind === "web" && w.document.web, { html: "private-page", cookie: "private-cookie" });
    const safe = sanitizeWorkspace(w), restored = restoreWorkspace(JSON.parse(JSON.stringify(safe)))!;
    expect(restored.document).toEqual(safe.document);
    expect(restored.document.kind).toBe("web");
    const serialized = JSON.stringify(safe);
    for (const secret of ["private-runtime", "private-page", "private-cookie"]) expect(serialized).not.toContain(secret);
    expect(serialized).toContain("获取失败"); expect(serialized).toContain('"headingIndex":1');
  });
  it("allows validated internal records but rejects standalone external web files and backups", () => {
    const w = webWorkspace(), raw = JSON.stringify(w);
    expect(parseReadingDocument(raw, true, true).document).toEqual(w.document);
    expect(() => parseReadingDocument(raw, true)).toThrow(/本机资源/);
    expect(() => workspaceToReadingDocument(w)).toThrow(/本机/);
  });
  it("detects media differences even when a stale producer reuses the same body hash", () => {
    const a = webWorkspace(), b = structuredClone(a);
    if (b.document.kind === "web") b.document.web.media[0].resourceId = "c".repeat(64);
    expect(readingContent(a)).not.toBe(readingContent(b));
    expect(hasRecoveryDifference(a, b)).toBe(true);
    const snapshot = { workspace: a, revisionId: "r", version: 1, position: { ratio: 0 } };
    expect(sameOriginal(snapshot, { ...snapshot, entryId: "e", workspace: b })).toBe(false);
    expect(canonical(a.document)).not.toBe(canonical(b.document));
  });
  it("rejects invalid media identities, references and content version mismatches", () => {
    const w = webWorkspace(); if (w.document.kind !== "web") throw new Error();
    const web = w.document.web;
    expect(copyWebDocument({ ...web, media: [...web.media, web.media[0]] })).toBeUndefined();
    expect(copyWebDocument({ ...web, media: [{ ...web.media[0], resourceId: "../../private" }] })).toBeUndefined();
    expect(copyWebDocument({ ...web, media: [{ ...web.media[1], resourceId: "b".repeat(64) }] })).toBeUndefined();
    expect(restoreWorkspace({ ...w, document: { ...w.document, contentHash: "c".repeat(64) } })).toBeNull();
  });
  it.each(["http://127.0.0.1/private", "http://[::1]/", "http://10.0.0.2/", "https://localhost/", "https://example.com:9443/", "https://user:password@example.com/", "https://example.com/?access_token=private", "https://example.com/?X-Amz-Signature=private", "file:///private"])("rejects nonpublic or credential source %s", url => {
    expect(safeWebUrl(url)).toBeUndefined();
    const w = webWorkspace(); if (w.document.kind !== "web") throw new Error();
    expect(copyWebDocument({ ...w.document.web, originalUrl: url })).toBeUndefined();
  });
  it("keeps ordinary query/fragment distinctions and legacy Markdown kind compatibility", () => {
    expect(safeWebUrl("https://claude.dev/article?q=second#section")).toBe("https://claude.dev/article?q=second#section");
    const old = createInitialWorkspace(); expect(restoreWorkspace(old)?.document.markdown).toBe(old.document.markdown);
  });
});

it("persists exact public-excerpt coverage through safe internal recovery and rejects inconsistent scope",()=>{
 const w=webWorkspace();if(w.document.kind!=="web")throw Error();w.document.web.coverage="public-excerpt";w.document.web.coverageReason="paywall";
 const saved=sanitizeWorkspace(w);expect(restoreWorkspace(JSON.parse(JSON.stringify(saved)))?.document).toEqual(saved.document);
 expect(copyWebDocument({...w.document.web,coverage:"complete"})).toBeUndefined();expect(copyWebDocument({...w.document.web,coverageReason:undefined})).toBeUndefined();
});
it("retains coverage in JSON export and discloses scope in knowledge-card Markdown",async()=>{const{workspaceToJson,workspaceToMarkdown}=await import('./export');const w=webWorkspace();if(w.document.kind!=="web")throw Error();w.document.web.coverage="public-excerpt";w.document.web.coverageReason="paywall";expect(JSON.parse(workspaceToJson(w)).document.web).toMatchObject({coverage:"public-excerpt",coverageReason:"paywall"});expect(workspaceToMarkdown(w)).toContain("付费内容未导入");expect(workspaceToMarkdown(w)).toContain(w.document.web.originalUrl);});
it("projects image32MiB and aggregate128MiB exact boundaries without dropping public scope",()=>{const w=webWorkspace();if(w.document.kind!=="web")throw Error();const web=w.document.web;web.coverage="public-excerpt";web.coverageReason="paywall";const media=web.media[0];web.media=Array.from({length:4},(_,i)=>({...media,id:'bounded-'+i,mime:'image/gif' as const,bytes:32*1024*1024}));expect(copyWebDocument(web)?.media).toHaveLength(4);expect(copyWebDocument({...web,media:[{...web.media[0],bytes:32*1024*1024+1}]})).toBeUndefined();expect(copyWebDocument({...web,media:[...web.media,{...web.media[0],id:'extra',bytes:1}]})).toBeUndefined();});
it('persists only approved public X image source links and keeps old missing records compatible',async()=>{const w=webWorkspace();if(w.document.kind!=='web')throw Error();w.document.web.originalUrl=w.document.web.finalUrl='https://x.com/sample/status/123';w.document.web.extractorVersion='x-fxtwitter-public-v1';w.document.web.retrieval={kind:'public-service',provider:'fxtwitter',url:'https://api.fxtwitter.com/2/status/123'};const missing=w.document.web.media.find(m=>m.status!=='saved')!;missing.kind='image';missing.sourceUrl='https://pbs.twimg.com/media/Sample.jpg?name=orig';const safe=sanitizeWorkspace(w),restored=restoreWorkspace(JSON.parse(JSON.stringify(safe)))!;expect(restored.document).toEqual(safe.document);const {workspaceToJson,workspaceToMarkdown}=await import('./export');expect(workspaceToMarkdown(safe)).toContain('图片未保存到本机');expect(workspaceToMarkdown(safe)).toContain(missing.sourceUrl);expect(JSON.parse(workspaceToJson(safe)).document.web.media.find((m:any)=>m.id===missing.id).sourceUrl).toBe(missing.sourceUrl);for(const url of['https://evil.example/a.jpg','http://pbs.twimg.com/media/a.jpg','https://pbs.twimg.com/profile_images/123/a.jpg','https://pbs.twimg.com/media/a.svg','https://pbs.twimg.com/media/a.jpg?token=secret','https://pbs.twimg.com/media/a.jpg?name=orig&name=large','https://pbs.twimg.com/amplify_video_thumb/123/img/a.jpg?name=small']){expect(copyWebDocument({...w.document.web,media:[{...missing,sourceUrl:url}]})).toBeUndefined();}for(const change of[{kind:'svg'},{status:'unsupported'}])expect(copyWebDocument({...w.document.web,media:[{...missing,...change}]})).toBeUndefined();expect(copyWebDocument({...w.document.web,media:[{...missing,sourceUrl:undefined}]})).toBeDefined();expect(copyWebDocument({...w.document.web,extractorVersion:'static',retrieval:undefined})).toBeDefined();});

it('projects only public HTTPS source URLs for ordinary static image retry without accepting resource overrides',()=>{const w=webWorkspace();if(w.document.kind!=='web')throw Error();const media={id:'missing-photo',kind:'image' as const,status:'missing' as const,alt:'Safe photo',reason:'network failure',sourceUrl:'https://cdn.example.org/static/image.png'};const web={...w.document.web,media:[media]};expect(copyWebDocument(web)?.media[0].sourceUrl).toBe(media.sourceUrl);for(const sourceUrl of['data:image/png;base64,a','file:///tmp/a.png','http://cdn.example.org/image.png','https://127.0.0.1/a.png','https://user:password@cdn.example.org/a.png','https://cdn.example.org/a.png?token=secret'])expect(copyWebDocument({...web,media:[{...media,sourceUrl}]})).toBeUndefined();expect(copyWebDocument({...web,media:[{...media,resourceId:'a'.repeat(64)}]})).toBeUndefined();});
