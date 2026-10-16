import ipaddr from "ipaddr.js";
import type { Workspace } from "../types";

export type WebMediaMime = "image/png" | "image/jpeg" | "image/webp" | "image/gif" | "image/svg+xml";
export interface WebMedia {
  id: string;
  kind: "image" | "svg";
  status: "saved" | "missing" | "unsupported";
  alt: string;
  caption?: string;
  resourceId?: string;
  mime?: WebMediaMime;
  bytes?: number;
  width?: number;
  height?: number;
  reason?: string;
  sourceUrl?: string;
  legacyMissing?: {reason:string;linked:boolean};
}
export interface WebFragment { fragment: string; headingIndex: number }
export interface WebDocumentData {
  version: 1;
  originalUrl: string;
  finalUrl: string;
  extractorVersion: string;
  contentVersion: string;
  media: WebMedia[];
  fragments: WebFragment[];
  retrieval?: {kind:"public-service";provider:"fxtwitter";url:string};
  identity?: {statusId:string;articleId:string;handle:string};
  coverage?: "public-excerpt";
  coverageReason?: "paywall";
}
export interface WebImportJob {
  operationId: string;
  status: "reading" | "ready" | "failed" | "cancelled" | "expired" | "existing";
  progress: string;
  error?: string;
  preview?: { workspace: Workspace; candidateId: string };
  entryId?: string;
  expiresAt?: string;
}

export const WEB_HASH = /^[a-f0-9]{64}$/;
export const WEB_MEDIA_ID = /^[A-Za-z0-9_-]{1,80}$/;
const credential = /(?:^|[-_])(?:token|auth|authorization|password|passwd|secret|signature|sig|credential|session|api[-_]?key|access[-_]?key|key)(?:$|[-_])|^x-amz-|^x-goog-/i;
/** Syntax-only check; server must additionally validate every DNS result and pin the connection. */
export function safeWebUrl(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length > 4096) return;
  try {
    const u = new URL(value);
    if (!["http:", "https:"].includes(u.protocol) || u.username || u.password
      || (u.port && u.port !== (u.protocol === "https:" ? "443" : "80"))) return;
    const host = u.hostname.replace(/^\[|\]$/g, "").toLowerCase();
    if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) return;
    if (ipaddr.isValid(host) && ipaddr.parse(host).range() !== "unicast") return;
    for (const key of u.searchParams.keys()) if (credential.test(key)) return;
    // Credentials in hash query strings are equally unsuitable for a saved public source.
    if (u.hash.includes("=")) for (const key of new URLSearchParams(u.hash.slice(1)).keys()) if (credential.test(key)) return;
    return u.href;
  } catch { return; }
}
/** Syntax-only public X image link; opening it requires an explicit user click. */
export function safeXImageSourceUrl(value:unknown):string|undefined {
 const safe=safeWebUrl(value);if(!safe)return;const u=new URL(safe);
 if(u.protocol!=='https:'||u.hostname!=='pbs.twimg.com'||u.port||u.hash)return;
 if(/^\/amplify_video_thumb\/\d{1,30}\/img\/[A-Za-z0-9_-]+\.(?:jpg|jpeg|png|webp)$/.test(u.pathname)){if([...u.searchParams.keys()].some(k=>k!=='name')||u.searchParams.getAll('name').length>1||u.searchParams.has('name')&&u.searchParams.get('name')!=='orig')return;return u.href;}
 if(!/^\/media\/[A-Za-z0-9_-]+(?:\.(?:jpg|jpeg|png|webp|gif))?$/.test(u.pathname)||[...u.searchParams.keys()].some(k=>!['format','name'].includes(k))||u.searchParams.getAll('format').length>1||u.searchParams.getAll('name').length>1||u.searchParams.has('format')&&!/^(jpg|jpeg|png|webp|gif)$/.test(u.searchParams.get('format')!)||u.searchParams.has('name')&&!/^(orig|large|medium|small|thumb|\d+x\d+)$/.test(u.searchParams.get('name')!))return;
 return u.href;
}
function record(value: unknown): value is Record<string, unknown> { return !!value && typeof value === "object" && !Array.isArray(value); }
function text(value: unknown, max: number): value is string { return typeof value === "string" && value.length <= max; }
export function safeImageSourceUrl(value:unknown):string|undefined { const safe=safeWebUrl(value);if(!safe)return;const u=new URL(safe);if(u.protocol!=="https:"||u.hash)return;return u.href; }
function copyMedia(value: unknown, publicX=false): WebMedia | undefined {
  if (!record(value) || typeof value.id !== "string" || !WEB_MEDIA_ID.test(value.id)
    || !["image", "svg"].includes(String(value.kind)) || !["saved", "missing", "unsupported"].includes(String(value.status))
    || !text(value.alt, 4000) || (value.caption !== undefined && !text(value.caption, 4000))
    || (value.sourceUrl !== undefined && (value.kind !== 'image' || value.status === 'unsupported' || !(publicX?safeXImageSourceUrl(value.sourceUrl):safeImageSourceUrl(value.sourceUrl))))
    || (value.legacyMissing !== undefined && (!record(value.legacyMissing) || value.kind!=='image' || value.status!=='saved' || Object.keys(value.legacyMissing).some(k=>!['reason','linked'].includes(k)) || !text(value.legacyMissing.reason,2000) || typeof value.legacyMissing.linked!=='boolean'))
    || (value.reason !== undefined && !text(value.reason, 2000))) return;
  const base = { id: value.id, kind: value.kind as WebMedia["kind"], status: value.status as WebMedia["status"], alt: value.alt,
    ...(value.sourceUrl === undefined ? {} : {sourceUrl:(publicX?safeXImageSourceUrl(value.sourceUrl):safeImageSourceUrl(value.sourceUrl))!}),
    ...(value.legacyMissing === undefined ? {} : {legacyMissing:{reason:(value.legacyMissing as {reason:string}).reason,linked:(value.legacyMissing as {linked:boolean}).linked}}),
    ...(value.caption === undefined ? {} : { caption: value.caption as string }), ...(value.reason === undefined ? {} : { reason: value.reason as string }) };
  if (value.status !== "saved") {
    if (!value.reason || ["resourceId", "mime", "bytes", "width", "height"].some(k => value[k] !== undefined)) return;
    return base;
  }
  if (typeof value.resourceId !== "string" || !WEB_HASH.test(value.resourceId)
    || !["image/png", "image/jpeg", "image/webp", "image/gif", "image/svg+xml"].includes(String(value.mime))
    || (value.kind === "svg") !== (value.mime === "image/svg+xml")
    || !Number.isSafeInteger(value.bytes) || Number(value.bytes) <= 0 || Number(value.bytes) > (value.kind === "svg" ? 1024 * 1024 : 32 * 1024 * 1024)) return;
  for (const k of ["width", "height"] as const) if (value[k] !== undefined && (!Number.isFinite(value[k]) || Number(value[k]) <= 0 || Number(value[k]) > 16384)) return;
  if (value.width !== undefined && value.height !== undefined && Number(value.width) * Number(value.height) > 40_000_000) return;
  return { ...base, resourceId: value.resourceId, mime: value.mime as WebMediaMime, bytes: Number(value.bytes),
    ...(value.width === undefined ? {} : { width: Number(value.width) }), ...(value.height === undefined ? {} : { height: Number(value.height) }) };
}
/** Validate and project only fields permitted in disk records and emergency drafts. */
export function copyWebDocument(value: unknown): WebDocumentData | undefined {
  if (!record(value) || value.version !== 1 || !safeWebUrl(value.originalUrl) || !safeWebUrl(value.finalUrl)
    || !text(value.extractorVersion, 200) || !value.extractorVersion || typeof value.contentVersion !== "string" || !WEB_HASH.test(value.contentVersion)
    || !Array.isArray(value.media) || value.media.length > 100 || !Array.isArray(value.fragments) || value.fragments.length > 10000) return;
  if ((value.coverage !== undefined || value.coverageReason !== undefined) && (value.coverage !== "public-excerpt" || value.coverageReason !== "paywall")) return;
  let retrieval:WebDocumentData["retrieval"],identity:WebDocumentData["identity"];
  if(value.identity!==undefined){const i=value.identity;if(!record(i)||Object.keys(i).some(k=>!["statusId","articleId","handle"].includes(k))||typeof i.statusId!=="string"||!/^\d{1,30}$/.test(i.statusId)||typeof i.articleId!=="string"||!/^\d{1,30}$/.test(i.articleId)||typeof i.handle!=="string"||!/^\w{1,15}$/.test(i.handle))return;identity={statusId:i.statusId,articleId:i.articleId,handle:i.handle};}
  if(value.retrieval!==undefined){const r=value.retrieval;if(!record(r)||Object.keys(r).some(k=>!["kind","provider","url"].includes(k))||r.kind!=="public-service"||r.provider!=="fxtwitter"||typeof r.url!=="string"||!/^https:\/\/api\.fxtwitter\.com\/2\/status\/\d{1,30}$/.test(r.url)||value.extractorVersion!=="x-fxtwitter-public-v1")return;
    const statusId=r.url.split("/").at(-1);if(identity&&identity.statusId!==statusId)return;
    for(const source of[value.originalUrl,value.finalUrl]){const u=new URL(source as string),m=/^\/(i|[A-Za-z0-9_]{1,15})\/(article|status)\/(\d{1,30})\/?$/.exec(u.pathname);if(u.protocol!=="https:"||!['x.com','www.x.com','twitter.com','www.twitter.com'].includes(u.hostname)||u.port||u.search||u.hash||!m||!(m[3]===statusId||m[2]==="article"&&identity?.articleId===m[3])||identity&&m[1]!=="i"&&m[1].toLowerCase()!==identity.handle.toLowerCase())return;}
    retrieval={kind:"public-service",provider:"fxtwitter",url:r.url};
  }
  if(value.extractorVersion==="x-fxtwitter-public-v1"&&!retrieval||identity&&!retrieval)return;
  const media = value.media.map(m=>copyMedia(m,!!retrieval));
  if (media.some(m => !m) || new Set(media.map(m => m!.id)).size !== media.length) return;
  if (media.reduce((bytes, m) => bytes + (m?.bytes ?? 0), 0) > 128 * 1024 * 1024) return;
  const fragments: WebFragment[] = [];
  for (const f of value.fragments) {
    if (!record(f) || !text(f.fragment, 400) || !f.fragment || !Number.isSafeInteger(f.headingIndex) || Number(f.headingIndex) < 0 || Number(f.headingIndex) > 10000) return;
    fragments.push({ fragment: f.fragment, headingIndex: Number(f.headingIndex) });
  }
  if (new Set(fragments.map(f => f.fragment)).size !== fragments.length) return;
  return { version: 1, originalUrl: safeWebUrl(value.originalUrl)!, finalUrl: safeWebUrl(value.finalUrl)!, extractorVersion: value.extractorVersion,
    ...(retrieval?{retrieval}:{}),...(identity?{identity}:{}), contentVersion: value.contentVersion, media: media as WebMedia[], fragments, ...(value.coverage === "public-excerpt" ? {coverage: "public-excerpt" as const, coverageReason: "paywall" as const} : {}) };
}
