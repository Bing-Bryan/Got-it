import {InquiryStreamError} from './lib/inquiry-stream';
import {loadSampleImages} from './lib/browser-library';
import {HOSTED,hostedCapabilities} from './lib/runtime-mode';
import {HostedSettings,HostedSamples,HostedSendDisclosure} from './HostedControls';
import {installUsage,track,markMaterial} from './lib/hosted-usage';
import {revealBookmarkRanges} from './lib/bookmark-navigation';
import { selectionContext,selectionRequestError } from './lib/inquiry-selection';
import { DocumentBookmarks } from './DocumentBookmarks';
import { useDocumentBookmarks } from './useDocumentBookmarks';
import { createBookmarkDraft, bookmarkDomRanges, type BookmarkDraft } from './lib/bookmark-selection';
import { applyBookmarkHighlights } from './lib/bookmark-highlights';
import { bookmarkQuote, bookmarkSegments, bookmarkPosition, type BookmarkCreate, type BookmarkResult } from './lib/bookmark-types';
import { useBookmarkFeedback } from './useBookmarkFeedback';
import { BookmarkAction } from './BookmarkAction';
import { BookmarksView } from './BookmarksView';
import type { ReadingBookmark } from './lib/bookmark-types';
import { WebTranslationControls } from "./WebTranslationControls";
import { translatedRendering, canonicalTranslationDraft, selectedQuote, translationContext } from "./lib/translation-reading";
import brandIcon from "./assets/got-it-icon.svg";
import { useResponsiveDrawer } from "./useResponsiveDrawer";
import { documentAnchor, documentQuestionContext, markdownSections } from "./lib/document-question";
import { MarkdownWidthControls } from "./MarkdownWidthControls";
import { useMarkdownWidth } from "./useMarkdownWidth";
import { renderedReadingMinutes } from "./lib/reading-time";
import { SelectionActions } from "./SelectionActions";
import { QuestionComposer } from "./QuestionComposer";
import PdfOutline from "./PdfOutline";
import type { PdfOutlineItem } from "./lib/pdf-outline";
import { revealReadingTarget, focusReadingTarget } from "./lib/reading-navigation";
import { useSidebar } from "./useSidebar";
import { useResultPanel } from "./useResultPanel";
import { CompactSources } from "./CompactSources";
import { PanelResizeHandle } from "./PanelResizeHandle";
import { CodexLogin } from "./CodexLogin";
import { useSaveStatus } from "./useSaveStatus";
import { capturePosition, restorePosition, useReadingLibrary } from "./useReadingLibrary";
import { ReadingLibraryNavigation, ReadingLibraryStatus } from "./ReadingLibraryView";
import { readDocumentFile } from "./lib/reading-document";
import { migrateHighlightAnchors } from "./lib/anchor-migration";
import { readingContext, questionContext } from "./lib/reading-context";
import { anchorGroup, inquiryCategoryStatus, intentHistory, sameAnchor, categoryIntent, rememberInquiry, preferredInquiry } from "./lib/inquiry-tabs";
import { modelConfig, resolveModelConfig, supportsConfig, type CodexModel, type ModelConfig } from "./lib/model-routing";
import { VerificationAnswer } from "./VerificationAnswer";
import { loadModelCatalog } from "./lib/model-catalog";
import { interruptMessage, PROGRESS_LABELS, readInquiryStream, responseMessage } from "./lib/inquiry-stream";
import { NEW_INQUIRY_INTENTS } from "./types";
import { safeSourceUrl } from "./lib/evidence";
import {
  Bookmark,
  BookMarked,
  BookOpenText,
  Bot,
  Check,
  ChevronDown,
  ChevronLeft,
  CircleAlert,
  ExternalLink,
  FileText,
  Info,
  Lightbulb,
  Link2,
  LoaderCircle,
  PanelRightOpen,
  PanelRightClose,
  PanelLeftOpen,
  Pin,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Terminal,
  Trash2,
  Upload,
  Waypoints,
  X,
} from "lucide-react";
import {
  lazy, Suspense,
  useCallback,
  useLayoutEffect,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type ChangeEvent,
  type DragEvent,
  type MouseEvent,
} from "react";
import {
  INTENT_META,
  type Inquiry,
  type InquiryIntent,
  type ActiveInquiryIntent,
  type InquiryRequest,
  type InquiryResponse,
  type ProviderId,
  type ProviderStatus,
  type SelectionDraft,
  type ThreadMessage,
  type Workspace,
} from "./types";
import { createInitialWorkspace } from "./sample";
import { REFINEMENTS, canCompleteInquiry, type Refinement } from "./lib/learning";
import { renderMarkdown } from "./lib/markdown";
import { loadWebMedia } from "./lib/web-media";
import { WebMediaRetry } from "./WebMediaRetry";
import { WebImageViewer } from "./WebImageViewer";
import {
  applyInquiryHighlights,
  emphasizeInquiryHighlight,
  findInquiryHighlight,
  createAnchorFromSelection,
} from "./lib/anchors";
import { loadWorkspace, saveWorkspace, restoreWorkspace, copyContextHistory } from "./lib/storage";

const FALLBACK_PROVIDERS: ProviderStatus[] = HOSTED?[{id:"deepseek",name:"DeepSeek",description:"选区解释与提问",availability:"checking",supportsWebSearch:false,localOnly:false}]:[
  {
    id: "codex",
    name: "Codex",
    description: "复用本机 ChatGPT 登录",
    availability: "checking",
    supportsWebSearch: true,
    localOnly: true,
  },

];

const INTENT_ICONS: Record<InquiryIntent, typeof Sparkles> = {
  explain: Lightbulb,
  why: Waypoints,
  verify: ShieldCheck,
  entity: BookMarked,
  ask: BookOpenText,
};


const PdfReader = lazy(() => import("./PdfReader"));

function newId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

function now(): string {
  return new Date().toISOString();
}

function readError(error: unknown): string {
  return error instanceof Error ? error.message : "发生未知错误，请重试。";
}

function App() {
  useEffect(installUsage,[]);
  const bookmarkFeedback=useBookmarkFeedback();
  const {failure:bookmarkFailure,notice:bookmarkNotice,version:bookmarkVersion,retrying:bookmarkRetrying,saved:bookmarkSaved}=bookmarkFeedback;
  const [bookmarksOpen,setBookmarksOpen]=useState(false);
  const bookmarkPositionRef=useRef<ReturnType<typeof capturePosition>|null>(null);
  const [bookmarkTarget,setBookmarkTarget]=useState<(ReadingBookmark&{locateNonce:number})|null>(null);
  const bookmarkLocateNonce=useRef(0);
  const bookmarkPreparing=useRef<{entryId:string;documentId:string;nonce:number;keepList:boolean}|null>(null);
  const bookmarkFocus=useRef<HTMLElement|null>(null);
  const [directoryTarget,setDirectoryTarget]=useState<{id:string;nonce:number}|null>(null);
  const [pdfDirectoryTarget, setPdfDirectoryTarget] = useState<{documentId:string;item:PdfOutlineItem;nonce:number}|null>(null);
  const [pdfCurrentPage, setPdfCurrentPage] = useState(1);
  const [workspace, setWorkspace] = useState<Workspace>(() => {
    let loaded = migrateHighlightAnchors((HOSTED?null:loadWorkspace()) ?? createInitialWorkspace());
    if(HOSTED)loaded={...loaded,document:{id:"hosted-welcome",isDemo:true,importedAt:new Date().toISOString(),filename:"欢迎使用 Got-it",markdown:"# 阅读，从你的材料开始\n\n使用左侧 + 添加 Markdown / PDF、公开网页或 X 链接，也可打开公开样例。\n\n选中文字后，可解释、提问并收藏原句。提问时，选区、有限上下文及追问历史会发送到托管服务与模型服务商；服务端不保存正文或回答。\n\n主动全文译中会将全部可翻译正文分批发送给托管服务与模型服务商；每批使用体验额度，原文保留。\n\n成果只保存在当前浏览器，请定期下载完整备份。",contentHash:"hosted-welcome-v2"}};
    try { const preferences = JSON.parse(localStorage.getItem("got-it.model-preferences.v1") || "null"); if (preferences) loaded = restoreWorkspace({ ...loaded, ...preferences }) ?? loaded; } catch { /* retain defaults */ }
    return { ...loaded, modelDefaultsVersion: 4, modelPreferences: loaded.modelDefaultsVersion === 4 ? loaded.modelPreferences : Object.fromEntries((["explain", "verify", "entity", "why", "ask"] as const).map(intent => [intent, modelConfig(intent)])), activeProviderId: HOSTED?"deepseek":"codex" };
  });
  const workspaceRef = useRef(workspace);
  workspaceRef.current = workspace;
  const [documentLoadId, setDocumentLoadId] = useState(0);
  const [codexModels, setCodexModels] = useState<CodexModel[]>([]);
  const [modelsLoading, setModelsLoading] = useState(true);
  const [modelsError, setModelsError] = useState("");
  const [providers, setProviders] = useState<ProviderStatus[]>(FALLBACK_PROVIDERS);
  const [bookmarkDraft,setBookmarkDraft]=useState<BookmarkDraft|null>(null);
  const bookmarkSelectionOperation=useRef<{draft:BookmarkDraft;operationId:string}|null>(null);
  const [bookmarkCompleted,setBookmarkCompleted]=useState<BookmarkCreate|null>(null);
  const bookmarkDraftRef=useRef(bookmarkDraft);bookmarkDraftRef.current=bookmarkDraft;
  const [inquirySelectionError,setInquirySelectionError]=useState('');
  const [selectionDraft, setSelectionDraft] = useState<SelectionDraft | null>(null);
  useEffect(() => {
    if (!selectionDraft&&!bookmarkDraft) return;
    const dismissSelection = (event: PointerEvent) => {
      if (event.button !== 0 || (event.target instanceof Element && event.target.closest('.selection-toolbar'))) return;
      // Dismiss before focus changes; otherwise the first click only blurs the
      // textarea and mouseup can reopen the toolbar from the old DOM selection.
      window.getSelection()?.removeAllRanges();
      setSelectionDraft(null);setBookmarkDraft(null);setInquirySelectionError('');
    };
    document.addEventListener('pointerdown', dismissSelection, true);
    return () => document.removeEventListener('pointerdown', dismissSelection, true);
  }, [selectionDraft,bookmarkDraft]);
  const [deleteMode, setDeleteMode] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [focusedInquiryId, setFocusedInquiryId] = useState<string | null>(null);
  const [providerOpen, setProviderOpen] = useState(false);
  const [settingsIntent, setSettingsIntent] = useState<InquiryIntent>("explain");
  const providerControlRef = useRef<HTMLDivElement>(null);
  const readerViewportRef = useRef<HTMLDivElement>(null);
  const [pdfToolbarHost, setPdfToolbarHost] = useState<HTMLDivElement | null>(null);
  const [adjustmentHost, setAdjustmentHost] = useState<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    const viewport = readerViewportRef.current;
    const provider = providerControlRef.current;
    if (!viewport || !provider) return;
    const align = () => {
      const trigger = provider.querySelector('.provider-trigger');
      if (trigger) {viewport.style.setProperty('--reader-adjustment-inset', `${Math.max(0, viewport.getBoundingClientRect().right - trigger.getBoundingClientRect().right)}px`);}
    };
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(align);
    observer?.observe(viewport); observer?.observe(provider);
    window.addEventListener('resize', align); align();
    return () => { observer?.disconnect(); window.removeEventListener('resize', align); };
  }, []);

  useEffect(() => {
    if (!providerOpen) return;
    const outside = (event: PointerEvent) => { if (!providerControlRef.current?.contains(event.target as Node)) setProviderOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { setProviderOpen(false); providerControlRef.current?.querySelector<HTMLButtonElement>(".provider-trigger")?.focus(); } };
    document.addEventListener("pointerdown", outside); document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape); };
  }, [providerOpen]);
  const [toast, setToast] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [pdfTarget,setPdfTarget] = useState<{id:string;nonce:number;returnToSource?:boolean}|null>(null);
  const sidebar = useSidebar();
  const resultPanel = useResultPanel();
  const openResultPanel = resultPanel.openReading;
  const listScrollRef = useRef<HTMLDivElement>(null);
  const listPositions = useRef(new Map<string, {top:number;id?:string}>());
  const restoreListFocus = useRef(false);
  const navigationSequence = useRef(0);
  const sidebarDrawer = useResponsiveDrawer({ narrow: sidebar.narrow, panel: sidebar.ref, desktopExpanded: sidebar.pinned || sidebar.peek, desktopTrigger: '.sidebar-rail button', desktopControl: '.desktop-sidebar-controls button' });
  const { open: mobileSidebarOpen, setOpen: setMobileSidebarOpen } = sidebarDrawer;
  const [documentQuestionOpen, setDocumentQuestionOpen] = useState(false);
  const resultDrawer = useResponsiveDrawer({ narrow: resultPanel.narrow, panel: resultPanel.ref, desktopExpanded: resultPanel.expanded, desktopTrigger: '.result-rail button', desktopControl: '.desktop-panel-controls button' });
  const { open: mobilePanelOpen, setOpen: setMobilePanelOpen } = resultDrawer;
  const fileInputRef = useRef<HTMLInputElement>(null);
  const articleRef = useRef<HTMLElement>(null);
  const markdownWidth = useMarkdownWidth(articleRef);
  const pendingCreations = useRef(new Map<string, SelectionDraft["anchor"]>());
  const requests = useRef(new Map<string, { id: string; controller: AbortController }>());
  const [progress, setProgress] = useState<Record<string, string>>({});
  useEffect(() => () => { for (const request of requests.current.values()) request.controller.abort(); }, []);
  const toastTimerRef = useRef<number | null>(null);

  const installLibraryWorkspace = useCallback((next: Workspace,entryId?:string) => {
    navigationSequence.current++;
    const pending=bookmarkPreparing.current;
    if(!pending||pending.entryId!==entryId||pending.documentId!==next.document.id){bookmarkPreparing.current=null;setBookmarkTarget(null);setBookmarksOpen(false);}
    else if(!pending.keepList)setBookmarksOpen(false);
    setPdfDirectoryTarget(null);setDirectoryTarget(null);
    workspaceRef.current = next; setWorkspace(next); setDocumentLoadId(v => v + 1);
    setDocumentQuestionOpen(false); setPdfTarget(null); setProgress({}); setSelectionDraft(null);setBookmarkDraft(null);setInquirySelectionError(''); setFocusedInquiryId(null); setMobileSidebarOpen(false); setMobilePanelOpen(false); setProviderOpen(false);
    window.getSelection()?.removeAllRanges();
  }, []);
  const interruptForSwitch = useCallback(() => {
    for (const request of requests.current.values()) request.controller.abort();
    requests.current.clear(); setProgress({});
    const next = restoreWorkspace(workspaceRef.current) ?? workspaceRef.current;
    workspaceRef.current = next; setWorkspace(next); return next;
  }, []);
  const library = useReadingLibrary({ workspace, install: installLibraryWorkspace, interrupt: interruptForSwitch, getWorkspace: () => workspaceRef.current, update: (next) => { workspaceRef.current=next;setWorkspace(next); } });
  const documentBookmarks=useDocumentBookmarks(library.entry?.id,bookmarkVersion);
  const activeBookmarkRevision=library.historyId||library.entry?.revisionId;
  const currentBookmarks=documentBookmarks.bookmarks.filter(bookmark=>bookmark.revisionId===activeBookmarkRevision);
  function beginBookmarkSave(request:BookmarkCreate){bookmarkFeedback.started(request);const draft=bookmarkDraftRef.current;if(draft)bookmarkSelectionOperation.current={draft,operationId:request.operationId};}
  function finishBookmarkSave(result:BookmarkResult,request:BookmarkCreate){
    bookmarkSaved(result,request);setBookmarkCompleted(request);
    const current=bookmarkDraftRef.current;
    if(current&&bookmarkSelectionOperation.current?.draft===current&&bookmarkSelectionOperation.current.operationId===request.operationId&&library.entry&&bookmarkPosition({entryId:library.entry.id,revisionId:library.entry.revisionId,anchor:current.anchor})===bookmarkPosition(request)){setBookmarkDraft(null);setSelectionDraft(null);setInquirySelectionError('');window.getSelection()?.removeAllRanges();}
  }
  useEffect(()=>{if(HOSTED&&library.entry)markMaterial(workspace.document.id.startsWith('sample-')?'sample':workspace.document.kind==='pdf'?'pdf':'markdown');},[library.entry?.id,workspace.document.id]);
  const saveStatus = useSaveStatus(library.status, workspace.document.id + ":" + documentLoadId);

  const [sampleImages,setSampleImages]=useState<Record<string,string>>({});
  useEffect(()=>{let active=true;setSampleImages({});if(HOSTED)void loadSampleImages(workspace.document.contentHash).then(images=>{if(active)setSampleImages(images);}).catch(()=>{});return()=>{active=false;};},[workspace.document.contentHash]);
  const rendered = useMemo(
    () => workspace.document.kind === "pdf" ? {html:"",outline:[]} : translatedRendering(workspace,sampleImages),
    [workspace.document, workspace.webTranslation, workspace.readingSide,sampleImages],
  );
  async function openBookmarks(){
    track("bookmarks-all");
    bookmarkPreparing.current=null;setBookmarkTarget(null);
    try {await library.prepareBookmarks();bookmarkPositionRef.current=capturePosition();setSelectionDraft(null);setBookmarkDraft(null);setInquirySelectionError('');window.getSelection()?.removeAllRanges();setBookmarksOpen(true);setMobileSidebarOpen(false);setMobilePanelOpen(false);}
    catch(e){showToast(e instanceof Error?e.message:"无法打开收藏，请重试。");}
  }
  function closeBookmarks(){bookmarkPreparing.current=null;setBookmarkTarget(null);setBookmarksOpen(false);requestAnimationFrame(()=>{if(bookmarkPositionRef.current)restorePosition(bookmarkPositionRef.current);const trigger=document.querySelector<HTMLButtonElement>(window.matchMedia('(max-width:780px)').matches?'.drawer-navigation-trigger':'.bookmarks-nav');trigger?.focus();});}
  async function locateBookmark(bookmark:ReadingBookmark){
    track("bookmark-locate");
    const attempt={entryId:bookmark.entryId,documentId:bookmark.documentId,nonce:++bookmarkLocateNonce.current,keepList:bookmarksOpen};bookmarkPreparing.current=attempt;
    try{if(!await library.openBookmark(bookmark.id))throw new Error('无法打开对应原文版本，收藏仍保留。请检查阅读库状态后重试。');
    if(bookmarkPreparing.current===attempt)setBookmarkTarget({...bookmark,locateNonce:attempt.nonce});}
    catch(error){if(bookmarkPreparing.current===attempt)bookmarkPreparing.current=null;throw error;}
  }
  useLayoutEffect(()=>{
    if(!bookmarkTarget)return;
    if(workspace.document.id!==bookmarkTarget.documentId)return;
    if(workspace.document.kind==='pdf')return;
    // Center while the list still covers the reader, then reveal the prepared source.
      library.rendered();
      const ranges=articleRef.current&&bookmarkDomRanges(articleRef.current,bookmarkTarget.anchor);
      const block=ranges?.[0]?.startContainer.parentElement?.closest<HTMLElement>('[data-block-id],[data-bookmark-block-id]');
      if(ranges&&block&&revealBookmarkRanges(ranges)) {bookmarkFocus.current=block;setBookmarksOpen(false);if(bookmarkSegments(bookmarkTarget.anchor).some(segment=>segment.translation))showToast('已定位对应原文段落（非逐词对齐）。');}
      else {showToast('无法定位收藏原文，摘录与上下文仍保留。');setBookmarksOpen(true);}
      bookmarkPreparing.current=null;setBookmarkTarget(null);
  },[bookmarkTarget,documentLoadId,rendered.html]);
  useLayoutEffect(()=>{if(bookmarksOpen||!bookmarkFocus.current)return;const block=bookmarkFocus.current;bookmarkFocus.current=null;if(block.isConnected)focusReadingTarget(block);},[bookmarksOpen,bookmarkTarget]);
  function jumpToHeading(id:string){
    track("outline");
    setMobileSidebarOpen(false);
    if(bookmarksOpen){bookmarkPreparing.current=null;setBookmarkTarget(null);setBookmarksOpen(false);setDirectoryTarget({id,nonce:Date.now()});return;}
    const target=document.getElementById(id);if(target){revealReadingTarget(target,{align:'start'});setCurrentHeading(id);}
  }
  useEffect(()=>{
    if(!directoryTarget||bookmarksOpen)return;let jumpFrame=0;
    const frame=requestAnimationFrame(()=>{library.rendered();jumpFrame=requestAnimationFrame(()=>{const target=document.getElementById(directoryTarget.id);if(target){revealReadingTarget(target,{align:'start'});setCurrentHeading(directoryTarget.id);}setDirectoryTarget(null);});});
    return()=>{cancelAnimationFrame(frame);cancelAnimationFrame(jumpFrame);};
  },[directoryTarget,bookmarksOpen]);
  useEffect(() => {
    const doc = workspace.document;
    if (doc.kind !== "web" || !articleRef.current || !library.entry) return;
    const revision = library.historyId || library.entry.revisionId;
    return loadWebMedia(articleRef.current, doc.web, id => `/entries/${library.entry!.id}/web-resources/${revision}/${id}`, () => library.rendered());
  }, [workspace.document, documentLoadId, library.entry?.id, library.historyId, rendered.html]);
  const [currentHeading, setCurrentHeading] = useState<string | null>(null);
  useEffect(() => {
    const scroll = document.querySelector<HTMLElement>('.reader-scroll');
    if (!scroll || workspace.document.kind === 'pdf') { setCurrentHeading(null); return; }
    let frame = 0;
    const update = () => {
      frame = 0;
      const top = scroll.getBoundingClientRect().top + 28;
      let active = rendered.outline[0]?.id ?? null;
      for (const item of rendered.outline) {
        const node = document.getElementById(item.id);
        if (node && node.getBoundingClientRect().top <= top) active = item.id;
        else if (node) break;
      }
      setCurrentHeading(active);
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(update); };
    schedule(); scroll.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    return () => { cancelAnimationFrame(frame); scroll.removeEventListener('scroll', schedule); window.removeEventListener('resize', schedule); };
  }, [rendered.outline, workspace.document.id, documentLoadId]);


  const markdownMinutes = useMemo(() => renderedReadingMinutes(rendered.html), [rendered.html]);
  const [pdfMinutes, setPdfMinutes] = useState<{ hash: string; minutes: number | null } | null>(null);
  const receivePdfMinutes = useCallback((hash: string, minutes: number | null) => setPdfMinutes({ hash, minutes }), []);
  const readingMinutes = workspace.document.kind === "pdf"
    ? (pdfMinutes?.hash === workspace.document.pdf.resourceId ? pdfMinutes.minutes : null)
    : markdownMinutes;

  const selectedInquiry = useMemo(
    () =>
      workspace.inquiries.find((item) => item.id === workspace.activeInquiryId) ??
      null,
    [workspace.activeInquiryId, workspace.inquiries],
  );

  const representative = workspace.inquiries.find(i => i.id === workspace.activeTab?.anchorInquiryId) ?? selectedInquiry;
  const tabIntent = categoryIntent(workspace.activeTab?.intent ?? selectedInquiry?.intent ?? "explain");
  const group = representative ? anchorGroup(workspace.inquiries, representative) : [];
  const history = intentHistory(group, tabIntent);
  const activeInquiry = selectedInquiry && categoryIntent(selectedInquiry.intent) === tabIntent ? selectedInquiry : null;
  const categoryItems = intentHistory(workspace.inquiries, tabIntent);
  const documentQuestionBusy = workspace.inquiries.some(i => i.anchor.scope === "document" && i.status === "answering");
  const listKey = `${workspace.document.id}:${library.entry?.revisionId ?? workspace.document.contentHash}:${tabIntent}`;
  const rememberList = () => {
    if (!activeInquiry && listScrollRef.current) {
      const old = listPositions.current.get(listKey);
      listPositions.current.set(listKey, {top:listScrollRef.current.scrollTop,id:old?.id});
    }
  };
  useLayoutEffect(() => {
    if (activeInquiry || !listScrollRef.current) return;
    const list = listScrollRef.current, saved = listPositions.current.get(listKey);
    list.scrollTop = Math.min(saved?.top ?? 0, Math.max(0, list.scrollHeight - list.clientHeight));
    if (restoreListFocus.current) {
      restoreListFocus.current = false;
      const buttons = [...list.querySelectorAll<HTMLButtonElement>('.category-open')];
      (buttons.find(b => b.dataset.inquiryId === saved?.id) ?? buttons[0] ?? document.getElementById(`intent-tab-${tabIntent}`))?.focus({preventScroll:true});
    }
  }, [listKey, activeInquiry?.id]);
  useEffect(() => {
    setDeleteMode(false); setPendingDeleteId(null);
  }, [documentLoadId, tabIntent, workspace.activeInquiryId]);
  useEffect(() => {
    if (!categoryItems.length || library.readOnly || library.busy || !library.ready) {
      setDeleteMode(false); setPendingDeleteId(null);
    }
  }, [categoryItems.length, library.readOnly, library.busy, library.ready]);
  const groupBusy = group.some(i => i.status === "answering");
  useEffect(() => { if (!providerOpen) setSettingsIntent(tabIntent === "why" ? "explain" : tabIntent); }, [tabIntent, providerOpen]);
  const currentModel = resolveModelConfig(settingsIntent, workspace.modelPreferences, codexModels);
  const selectedModelInfo = codexModels.find(model => model.model === currentModel.model);
  const modelReady = workspace.activeProviderId !== "codex" || (!modelsLoading && !modelsError && supportsConfig(codexModels, resolveModelConfig(tabIntent, workspace.modelPreferences, codexModels)));

  const activeProvider = useMemo(
    () =>
      providers.find((item) => item.id === workspace.activeProviderId) ??
      providers.find((item) => item.id === "codex") ?? FALLBACK_PROVIDERS[0],
    [providers, workspace.activeProviderId],
  );

  const showToast = useCallback((message: string) => {
    setToast(message);
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setToast(null), 3400);
  }, []);

  const refreshModels = useCallback(async (refresh = false) => {
    if(HOSTED){setModelsLoading(false);return;}
    setModelsLoading(true); setModelsError("");
    try {
      setCodexModels(await loadModelCatalog(refresh));
    } catch (error) { setCodexModels([]); setModelsError(readError(error)); }
    finally { setModelsLoading(false); }
  }, []);
  useEffect(() => { void refreshModels(); }, [refreshModels]);

  useEffect(() => {
    if (modelsLoading || modelsError || !codexModels.length) return;
    const intents = ["explain", "verify", "entity", "why", "ask"] as const;
    const repaired = intents.filter(intent => JSON.stringify(resolveModelConfig(intent, workspace.modelPreferences, codexModels)) !== JSON.stringify(modelConfig(intent, workspace.modelPreferences)));
    if (!repaired.length) return;
    setWorkspace(current => ({ ...current, modelPreferences: Object.fromEntries(intents.map(intent => [intent, resolveModelConfig(intent, current.modelPreferences, codexModels)])), updatedAt: now(), hasUnexportedChanges: true }));
    showToast("已更新为可用的模型配置，可直接开始；也可以自行调整。");
  }, [codexModels, modelsLoading, modelsError, workspace.modelPreferences, showToast]);

  const refreshProviders = useCallback(async () => {
    if(HOSTED){try{const c=await hostedCapabilities();setProviders([{...FALLBACK_PROVIDERS[0],supportsWebSearch:c.supportsWebSearch,availability:c.available?"connected":"unavailable",detail:c.quota.globalExhausted?"今日体验额度已用完":`今日剩余 ${c.quota.remaining} 次`}]);}catch{setProviders([{...FALLBACK_PROVIDERS[0],availability:"unavailable",detail:"体验服务暂时无法连接"}]);}return;}
    try {
      const response = await fetch("/api/providers");
      if (!response.ok) throw new Error("Provider 状态服务暂不可用");
      const data = (await response.json()) as {
        providers: ProviderStatus[];
        defaultProviderId: ProviderId;
      };
      const codex = data.providers.find(provider => provider.id === "codex");
      setProviders(codex ? [codex] : FALLBACK_PROVIDERS.map(provider => ({ ...provider, availability: "unavailable", detail: "本地服务未提供 Codex，请更新并重启服务。" })));
      setWorkspace(current => current.activeProviderId === "codex" ? current : { ...current, activeProviderId: "codex" });
    } catch {
      setProviders(FALLBACK_PROVIDERS.map(provider => ({ ...provider, availability: "unavailable", detail: "无法连接本地 API 服务，请启动服务后重试。" })));
      showToast("无法连接模型服务，请检查本地 API；本次不会生成占位回答。");
    }
  }, []);

  const onCodexConnected = useCallback(async () => { await Promise.all([refreshProviders(), refreshModels(true)]); }, [refreshProviders, refreshModels]);

  useEffect(() => {
    void refreshProviders();
  }, [refreshProviders]);

  useEffect(() => {
    if (HOSTED || !workspace.document.isDemo) return;
    const result = saveWorkspace(workspace);
    if (!result.ok) showToast(result.error);
  }, [showToast, workspace]);

  useEffect(() => {
    const article = articleRef.current;
    if (!article) return;
    const missingInquiryIds = new Set<string>();
    const recoveredInquiryIds = new Set<string>();
    const cleanup = applyInquiryHighlights(
      article,
      workspace.inquiries,
      workspace.activeInquiryId,
      (inquiry) => {
        if (inquiry.anchor.matchStatus !== "needs-relink") {
          missingInquiryIds.add(inquiry.id);
        }
      },
      inquiry => { if (inquiry.anchor.matchStatus === "needs-relink") recoveredInquiryIds.add(inquiry.id); },
    );

    if (missingInquiryIds.size > 0 || recoveredInquiryIds.size > 0) {
      setWorkspace((current) => {
        let changed = false;
        const inquiries = current.inquiries.map((inquiry) => {
          if (recoveredInquiryIds.has(inquiry.id)) { changed = true; return { ...inquiry, anchor: { ...inquiry.anchor, matchStatus: "matched" as const } }; }
          if (!missingInquiryIds.has(inquiry.id) || inquiry.anchor.matchStatus === "needs-relink") {
            return inquiry;
          }
          changed = true;
          return {
            ...inquiry,
            anchor: { ...inquiry.anchor, matchStatus: "needs-relink" as const },
          };
        });
        return changed
          ? { ...current, inquiries, updatedAt: now(), hasUnexportedChanges: true }
          : current;
      });
    }

    return cleanup;
  }, [rendered.html, workspace.activeInquiryId, workspace.inquiries]);
  useEffect(()=>{const article=articleRef.current;if(!article)return;return applyBookmarkHighlights(article,currentBookmarks);},[rendered.html,workspace.activeInquiryId,workspace.inquiries,documentBookmarks.bookmarks,activeBookmarkRevision]);

  useEffect(() => {
    const article = articleRef.current;
    if (!article) return;
    const focused = !activeInquiry && categoryItems.find(item => item.id === focusedInquiryId && item.anchor.matchStatus === "matched");
    emphasizeInquiryHighlight(article, workspace.inquiries, focused ? focused.id : activeInquiry?.id ?? null);
    if (focusedInquiryId && !focused) setFocusedInquiryId(null);
  }, [focusedInquiryId, activeInquiry, tabIntent, rendered.html, workspace.inquiries]);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (workspace.document.kind === "pdf" || workspace.document.kind === "web") return;
    if (library.entry) {
      const frame = window.requestAnimationFrame(() => library.rendered());
      return () => window.cancelAnimationFrame(frame);
    }
    const id = workspace.activeInquiryId;
    if (!id) return;
    const frame = window.requestAnimationFrame(() => {
      const target = [...(articleRef.current?.querySelectorAll<HTMLElement>("mark[data-inquiry-id]") ?? [])].find(mark => mark.dataset.inquiryId === id);
      if (target) revealReadingTarget(target);
    });
    return () => window.cancelAnimationFrame(frame);
    // Intentionally only restore on document load; request updates must not move reading position.
  }, [workspace.document.id, documentLoadId]);

  const updateWorkspace = useCallback(
    (recipe: (current: Workspace) => Workspace) => {
      const next = { ...recipe(workspaceRef.current), updatedAt: now(), hasUnexportedChanges: true };
      workspaceRef.current = next; setWorkspace(next);
    },
    [],
  );

  const updateInquiry = useCallback(
    (inquiryId: string, recipe: (inquiry: Inquiry) => Inquiry) => {
      if (library.readOnly || library.busy || !library.ready) return;
      updateWorkspace((current) => ({
        ...current,
        inquiries: current.inquiries.map((inquiry) =>
          inquiry.id === inquiryId ? recipe(inquiry) : inquiry,
        ),
      }));
    },
    [updateWorkspace, library.readOnly, library.busy, library.ready, library.entry?.id],
  );

  const askProvider = useCallback(
    async (inquiryId: string, request: InquiryRequest) => {
      if (library.readOnly || library.busy || !library.ready || requests.current.has(inquiryId)) return;
      if(request.history?.length){const rounds=request.history.filter(m=>m.role==='user').length;track(rounds>=6?'follow-up-6plus':'follow-up-2to5');}
      track(request.intent==='verify'?'verify':request.readingScope==='document'?'document-ask':request.history?.length?'follow-up':request.intent==='ask'?'ask':'explain');
      const requestId = newId("request"), messageId = newId("message"), controller = new AbortController();
      const operation = request.operation ?? (request.intent === "why" ? "explain" : request.intent);
      const imageAnchor=workspaceRef.current.inquiries.find(i=>i.id===inquiryId)?.anchor.pdf;
      const image=request.image ?? (imageAnchor?.kind==="region" && library.entry ? {entryId:library.entry.id,fileHash:imageAnchor.fileHash,cropId:imageAnchor.cropId!} : undefined);
      const scoped = { ...request, ...(image?{image}:{}), modelConfig: request.providerId === "codex" ? request.modelConfig ?? resolveModelConfig(operation, workspace.modelPreferences, codexModels) : undefined, requestId, operation, scope: request.scope ?? "initial" as const, round: request.round ?? 1 };
      requests.current.set(inquiryId, { id: requestId, controller });
      updateInquiry(inquiryId, inquiry => ({ ...inquiry, messages: [...inquiry.messages, { id: messageId, role: "assistant", content: "", createdAt: now(), modelConfig: scoped.modelConfig, requestId, completion: "provisional", operation: scoped.operation, explanationMode: scoped.explanationMode, scope: scoped.scope, round: scoped.round, parentMessageId: scoped.parentMessageId }] }));
      let contextNotice = "";
      try {
        if (scoped.readingScope === "document") {
          setProgress(current => ({ ...current, [inquiryId]: "正在读取本文文字" }));
          const document = workspaceRef.current.document;
          let sections = markdownSections(articleRef.current), notice = "";
          if (document.kind === "pdf") {
            if (!library.entry) throw new Error("请先将文档加入阅读库。");
            const { readDocumentPdfText } = await import("./lib/document-pdf-text");
            controller.signal.throwIfAborted();
            const result = await readDocumentPdfText(library.entry.id, document.pdf.resourceId, controller.signal);
            sections = result.sections; notice = result.notice;
          }
          controller.signal.throwIfAborted();
          const prepared = documentQuestionContext(sections, scoped.question, notice);
          scoped.context = prepared.context; contextNotice = prepared.notice;
          updateInquiry(inquiryId, inquiry => ({ ...inquiry, messages: inquiry.messages.map(message => message.id === messageId ? { ...message, contextNotice } : message) }));
        }
        await readInquiryStream(scoped, event => {
          if (requests.current.get(inquiryId)?.id !== requestId) return;
          if (event.type === "answer-delta" && event.delta?.trim()) setProgress(current => ({ ...current, [inquiryId]: "正在生成正文" }));
          if (event.progress) setProgress(current => ({ ...current, [inquiryId]: PROGRESS_LABELS[event.progress!] }));
          updateInquiry(inquiryId, inquiry => ({ ...inquiry,
            messages: inquiry.messages.map(message => message.id !== messageId ? message : event.response
              ? { ...responseMessage(messageId, scoped, event.response, event.type === "complete"), timings: event.timings, contextNotice }
              : event.type === "answer-delta" ? { ...message, content: message.content + event.delta, timings: event.timings }
              : event.source ? { ...message, sources: message.sources?.map(source => source.id === event.source!.id ? event.source! : source) } : message),
            status: event.type === "complete" ? scoped.operation === "verify" && event.response?.evidenceStatus !== "supported" ? "needs-verification" : "ready" : "answering",
            lastError: undefined, updatedAt: now(),
          }));
        }, controller.signal);
      } catch (error) {
        if(scoped.intent==='verify'&&!controller.signal.aborted)track('verify-failed');
        track(controller.signal.aborted?'answer-stop':/额度/.test(readError(error))?'quota-exhausted':'model-failed');
        if (requests.current.get(inquiryId)?.id === requestId) updateInquiry(inquiryId, inquiry => ({ ...inquiry,
          messages: inquiry.messages.map(message => message.id === messageId ? {...interruptMessage(message),...(error instanceof InquiryStreamError&&error.search?{search:error.search}:{})} : message),
          status: "ready", updatedAt: now(), lastError: readError(error),
        }));
      } finally {
        if (requests.current.get(inquiryId)?.id === requestId) {
          requests.current.delete(inquiryId);
          setProgress(current => { const next = { ...current }; delete next[inquiryId]; return next; });
        }
      }
    },
    [updateInquiry, workspace.modelPreferences, codexModels, library.readOnly, library.busy, library.ready, library.entry?.id],
  );

  const handleArticleMouseUp = useCallback(() => {
    if (library.readOnly || library.busy || !library.ready) return;
    window.requestAnimationFrame(() => {
      const article = articleRef.current;
      const selection = window.getSelection();
      if (!article || !selection || selection.isCollapsed) {
        setSelectionDraft(null);setBookmarkDraft(null);
        return;
      }
      const bookmark=createBookmarkDraft(selection,article,workspace);
      if('error' in bookmark){setBookmarkDraft(null);setSelectionDraft(null);showToast(bookmark.error);return;}
      setBookmarkDraft(bookmark);
      setSelectionDraft(bookmark);setInquirySelectionError('');track('selection-shown');
    });
  }, [showToast, workspace.document.id, workspace.webTranslation, workspace.readingSide, library.readOnly, library.busy, library.ready]);

  const createInquiry = useCallback(
    async (intent: ActiveInquiryIntent, draftOverride?: SelectionDraft, customQuestion?: string, contextHistory?: Inquiry["contextHistory"]) => {
      if (library.readOnly || library.busy || !library.ready) return;
      const draft = draftOverride ?? selectionDraft;
      if (!draft) return;
      if(HOSTED&&!library.entry){const sourceId=workspaceRef.current.document.id,visit=navigationSequence.current,selection=bookmarkDraftRef.current,nativeSelection=window.getSelection()?.toString();try{await library.ensureEntry();}catch(error){showToast(readError(error));return;}if(workspaceRef.current.document.id!==sourceId||navigationSequence.current!==visit||(!draftOverride&&(bookmarkDraftRef.current!==selection||window.getSelection()?.toString()!==nativeSelection)))return;}
      if (workspace.activeProviderId === "codex" && (modelsLoading || modelsError || !codexModels.length)) { showToast("请先等待模型列表加载完成，或刷新连接后再试。"); return; }
      const matches = workspace.inquiries.filter(i => sameAnchor(i.anchor, draft.anchor));
      if (intent === "ask" && (!customQuestion?.trim() || customQuestion.length > 2000)) return;
      const existing = intentHistory(matches, intent).find(i => intent !== "ask" || i.question === customQuestion?.trim());
      if (existing) {
        updateWorkspace(current => ({ ...current, activeInquiryId: existing.id, visitedInquiryIds: rememberInquiry(current, existing.id), activeTab: { anchorInquiryId: existing.id, intent: categoryIntent(intent) } }));
        setSelectionDraft(null);setBookmarkDraft(null); setMobilePanelOpen(true); openResultPanel(); window.getSelection()?.removeAllRanges(); return;
      }
      if (matches.some(i => i.status === "answering") || [...pendingCreations.current.values()].some(a => sameAnchor(a, draft.anchor))) return;
      const createdAt = now();
      const id = newId("inquiry");
      const question = intent === "ask" ? customQuestion!.trim() : draft.anchor.segments ? INTENT_META[intent].prompt('这段完整选区') : INTENT_META[intent].prompt(selectedQuote(draft.anchor));
      const context=selectionContext(articleRef.current,draft.anchor,intent,question);
      const requestError=selectionRequestError(draft.anchor,question,context,intent);if(requestError){showToast(requestError);return;}
      const userMessage: ThreadMessage = {
        id: newId("message"),
        role: "user",
        content: question,
        createdAt,
        providerId: workspace.activeProviderId,
      };
      const inquiry: Inquiry = {
        id,
        intent,
        question,
        ...(contextHistory?.length ? {contextHistory: copyContextHistory(contextHistory)} : {}),
        anchor: draft.anchor,
        status: "answering",
        messages: [userMessage],
        understanding: "",
        createdAt,
        updatedAt: createdAt,
      };

      updateWorkspace((current) => ({
        ...current,
        inquiries: [...current.inquiries, inquiry],
        activeInquiryId: id,
        activeTab: { anchorInquiryId: id, intent },
      }));
      const request: InquiryRequest = {
        providerId: workspace.activeProviderId,
        ...(draft.anchor.pdf?.kind === "region" && library.entry ? {image:{entryId:library.entry.id,fileHash:draft.anchor.pdf.fileHash,cropId:draft.anchor.pdf.cropId!}} : {}),
        intent,
        ...(["explain", "ask"].includes(intent) ? {explanationMode:"auto" as const} : {}),
        ...(draft.anchor.scope === "document" ? { readingScope: "document" as const } : {}),
        quote: selectedQuote(draft.anchor),
        context,
        documentTitle: workspace.document.filename,
        question,
        history: copyContextHistory(contextHistory),
      };
      setSelectionDraft(null);setBookmarkDraft(null);
      setMobilePanelOpen(true); openResultPanel();
      window.getSelection()?.removeAllRanges();
      pendingCreations.current.set(id, draft.anchor);
      void askProvider(id, request).finally(() => pendingCreations.current.delete(id));
    },
    [askProvider, workspace.inquiries, selectionDraft, updateWorkspace, workspace.activeProviderId, workspace.document.filename, modelsLoading, modelsError, codexModels, showToast, openResultPanel],
  );

  const submitFollowUp = useCallback(
    (action: Refinement) => {
      if (!activeInquiry || groupBusy || !canCompleteInquiry(activeInquiry)) return;
      if (activeInquiry.intent === "verify" || (action === "detail") !== (activeInquiry.intent === "entity")) return;
      if (action === "web" && !activeProvider.supportsWebSearch) return;
      const content = REFINEMENTS[action].prompt;
      const followContext=selectionContext(articleRef.current,activeInquiry.anchor,activeInquiry.intent==='why'?'explain':activeInquiry.intent,content);
      const followError=selectionRequestError(activeInquiry.anchor,content,followContext,activeInquiry.intent==='why'?'explain':activeInquiry.intent);if(followError){showToast(followError);return;}
      const userMessage: ThreadMessage = {
        id: newId("message"),
        role: "user",
        content,
        createdAt: now(),
        providerId: workspace.activeProviderId,
      };
      const history = activeInquiry.messages.filter(m => m.content.trim()).slice(-12).map(({ role, content }) => ({
        role,
        content,
      }));
      updateInquiry(activeInquiry.id, (inquiry) => ({
        ...inquiry,
        messages: [...inquiry.messages, userMessage],
        status: "answering",
        updatedAt: now(),
        lastError: undefined,
      }));
      void askProvider(activeInquiry.id, {
        providerId: workspace.activeProviderId,
        intent: activeInquiry.intent,
        operation: action === "detail" ? "entity" : "explain",
        ...(action !== "detail" ? { explanationMode: action === "web" ? "web" as const : "auto" as const } : {}),
        quote: selectedQuote(activeInquiry.anchor),
        context:followContext,
        documentTitle: workspace.document.filename,
        question: content,
        history,
      });
    }, [activeInquiry, groupBusy, askProvider, updateInquiry, workspace.activeProviderId, workspace.document.filename, activeProvider.supportsWebSearch],
  );

  const submitCustomQuestion = (question: string) => {
    if (!activeInquiry || groupBusy || !modelReady) return;
    if (activeInquiry.intent !== 'ask') {
      createInquiry('ask', {anchor:activeInquiry.anchor,context:readingContext(articleRef.current, activeInquiry.anchor),rect:{top:0,left:0,width:0,height:0}}, question, copyContextHistory(activeInquiry.messages));
      return;
    }
    if (!question.trim() || question.length > 2000 || requests.current.has(activeInquiry.id)) return;
    const nextContext=selectionContext(articleRef.current,activeInquiry.anchor,'ask',question);
    const nextError=selectionRequestError(activeInquiry.anchor,question,nextContext,'ask');if(nextError){showToast(nextError);return;}
    const history = [...(activeInquiry.contextHistory ?? []), ...activeInquiry.messages].filter(m => m.content.trim()).slice(-8).map(({role,content}) => ({role,content:content.slice(0,3000)}));
    updateInquiry(activeInquiry.id, i => ({...i,status:'answering',lastError:undefined,messages:[...i.messages,{id:newId('message'),role:'user',content:question.trim(),createdAt:now()}]}));
    void askProvider(activeInquiry.id, {providerId:workspace.activeProviderId,intent:'ask',operation:'ask',explanationMode:'auto',readingScope:activeInquiry.anchor.scope,quote:selectedQuote(activeInquiry.anchor),context:nextContext,documentTitle:workspace.document.filename,question:question.trim(),history});
  };

  const retryInquiry = useCallback(() => {
    track("answer-regenerate");
    if (!activeInquiry || groupBusy || requests.current.has(activeInquiry.id)) return;
    const failed = activeInquiry.messages.at(-1);
    const parentMessageId = failed?.parentMessageId ?? failed?.verification?.parentMessageId;
    const parent = activeInquiry.messages.find(m => m.id === parentMessageId);
    const lastUserMessage = [...activeInquiry.messages]
      .reverse()
      .find((message) => message.role === "user");
    const retryQuestion=lastUserMessage?.content??activeInquiry.question;
    const retryContext=selectionContext(articleRef.current,activeInquiry.anchor,activeInquiry.intent==='why'?'explain':activeInquiry.intent,retryQuestion);
    const retryError=selectionRequestError(activeInquiry.anchor,retryQuestion,retryContext,activeInquiry.intent==='why'?'explain':activeInquiry.intent);if(retryError){showToast(retryError);return;}
    updateInquiry(activeInquiry.id, (inquiry) => ({
      ...inquiry,
      status: "answering",
      lastError: undefined,
    }));
    void askProvider(activeInquiry.id, {
      providerId: workspace.activeProviderId,
      intent: activeInquiry.intent,
      readingScope: activeInquiry.anchor.scope,
      quote: selectedQuote(activeInquiry.anchor),
      context:retryContext,
      documentTitle: workspace.document.filename,
      modelConfig: failed?.modelConfig,
      explanationMode: failed?.explanationMode,
      operation: failed?.operation ?? (activeInquiry.intent === "why" ? "explain" : activeInquiry.intent),
      scope: failed?.scope ?? failed?.verification?.scope ?? "initial", round: failed?.round ?? failed?.verification?.round ?? 1, parentMessageId,
      previous: parent?.verification ? { verification: parent.verification, sources: parent.sources ?? [] } : undefined,
      question: lastUserMessage?.content ?? activeInquiry.question,
      history: [...(activeInquiry.contextHistory ?? []), ...activeInquiry.messages.slice(0, lastUserMessage ? activeInquiry.messages.lastIndexOf(lastUserMessage) : 0)].filter(m => m.content.trim()).slice(-12).map(({ role, content }) => ({ role, content })),
    });
  }, [activeInquiry, groupBusy, askProvider, updateInquiry, workspace.activeProviderId, workspace.document.filename]);

  const cancelInquiry = () => {
    if (!activeInquiry) return;
    const pending = requests.current.get(activeInquiry.id);
    if (!pending) return;
    requests.current.delete(activeInquiry.id);
    pending.controller.abort();
    setProgress(current => { const next = { ...current }; delete next[activeInquiry.id]; return next; });
    updateInquiry(activeInquiry.id, inquiry => ({ ...inquiry, status: "ready", lastError: "已停止本次请求；已收到的内容已保留，可手动重试。", messages: inquiry.messages.map(interruptMessage), updatedAt: now() }));
  };

  const deleteInquiry = (inquiryId: string) => {
    if (!deleteMode || library.readOnly || library.busy || !library.ready) return;
    if (pendingDeleteId !== inquiryId) { setPendingDeleteId(inquiryId); return; }
    const remaining = categoryItems.filter(item => item.id !== inquiryId);
    const index = categoryItems.findIndex(item => item.id === inquiryId);
    const nextId = remaining[Math.min(index, remaining.length - 1)]?.id;
    // Invalidate callbacks before aborting: late output must never restore a deleted thread.
    const request = requests.current.get(inquiryId);
    requests.current.delete(inquiryId);
    request?.controller.abort();
    setProgress(current => { const next = { ...current }; delete next[inquiryId]; return next; });
    setPendingDeleteId(null);
    setFocusedInquiryId(null);
    setPdfTarget(current => current?.id === inquiryId ? null : current);
    updateWorkspace(current => ({
      ...current,
      inquiries: current.inquiries.filter(item => item.id !== inquiryId),
      activeInquiryId: current.activeInquiryId === inquiryId ? null : current.activeInquiryId,
      activeTab: current.activeTab?.anchorInquiryId === inquiryId ? { intent: current.activeTab.intent } : current.activeTab,
    }));
    const documentId = workspace.document.id;
    window.requestAnimationFrame(() => {
      if (workspaceRef.current.document.id !== documentId || workspaceRef.current.activeInquiryId) return;
      const buttons = document.querySelectorAll<HTMLButtonElement>('[data-delete-inquiry-id]');
      ([...buttons].find(button => button.dataset.deleteInquiryId === nextId)
        ?? document.getElementById(nextId ? 'inquiry-delete-toggle' : `intent-tab-${tabIntent}`))?.focus();
    });
  };

  const switchTab = (intent: InquiryIntent, restoreFocus = false) => {
    rememberList();
    navigationSequence.current++;
    setPdfTarget(null);
    restoreListFocus.current = restoreFocus;
    setDeleteMode(false); setPendingDeleteId(null);
    setFocusedInquiryId(null);
    updateWorkspace(current => ({ ...current, activeInquiryId: null, activeTab: { intent } }));
  };
  const changeModel = (config: ModelConfig) => updateWorkspace(current => ({ ...current, modelPreferences: { ...current.modelPreferences, [settingsIntent]: config } }));

  const selectProvider = useCallback(
    (provider: ProviderStatus) => {
      if (provider.id !== "codex") return;
      if (provider.id === "codex" && provider.availability !== "connected") {
        showToast("请使用下方登录 Codex，完成后会自动更新连接状态。");
        return;
      }
      updateWorkspace((current) => ({ ...current, activeProviderId: provider.id }));
      setProviderOpen(false);
    },
    [showToast, updateWorkspace],
  );

  const importFile = library.importFile;

  const handleFileChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (file) void importFile(file);
      event.target.value = "";
    },
    [importFile],
  );

  const handleDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      setIsDragging(false);
      const file = event.dataTransfer.files?.[0];
      if (file) void importFile(file);
    },
    [importFile],
  );

  const [sourceFocus, setSourceFocus] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => {
    if (mobilePanelOpen || !sourceFocus) return;
    if (sourceFocus.isConnected && !sourceFocus.closest('[inert]')) focusReadingTarget(sourceFocus);
    setSourceFocus(null);
  }, [mobilePanelOpen, sourceFocus]);
  const finishSourceNavigation = useCallback((id: string, success: boolean, returnToSource = false, target?: HTMLElement) => {
    if (workspaceRef.current.activeInquiryId !== id) return;
    if (!success) { showToast("原文位置无法恢复，请在原文件中查看；已有回答仍保留。"); return; }
    if (returnToSource && window.matchMedia('(max-width: 780px)').matches) {
      setMobilePanelOpen(false);
      if (target) setSourceFocus(target);
    }
  }, [showToast]);

  const locateInquiry = useCallback((inquiryId: string, returnToSource = false) => {
    const current = workspaceRef.current;
    const inquiry = current.inquiries.find(i => i.id === inquiryId);
    if (inquiry?.anchor.scope === "document") return;
    // PDF stickies always keep their original-page boxes, so an older draft translation still locates there.
    if (current.document.kind !== "pdf" && current.readingSide === "translated" && inquiry?.anchor.translation && (inquiry.anchor.translation.translationId !== current.webTranslation?.id || inquiry.anchor.translation.version !== current.webTranslation?.version)) { showToast("旧译文摘录仍保留；当前译文版本不同，请用对应原文段落回看。"); return; }
    const sequence = ++navigationSequence.current;
    if (!inquiry || inquiry.anchor.matchStatus !== 'matched') { finishSourceNavigation(inquiryId, false); return; }
    if (current.document.kind === 'pdf') {
      const pdf = inquiry.anchor.pdf;
      if (!pdf || pdf.fileHash !== current.document.pdf.resourceId || pdf.page < 1 || pdf.page > current.document.pdf.pages.length) { finishSourceNavigation(inquiryId, false); return; }
      setPdfTarget({id:inquiryId,nonce:sequence,returnToSource});
      return;
    }
    window.requestAnimationFrame(() => {
      if (sequence !== navigationSequence.current || workspaceRef.current.document !== current.document || workspaceRef.current.activeInquiryId !== inquiryId) return;
      const target = articleRef.current && findInquiryHighlight(articleRef.current, workspaceRef.current.inquiries, inquiryId);
      finishSourceNavigation(inquiryId, !!target && revealReadingTarget(target), returnToSource, target ?? undefined);
    });
  }, [finishSourceNavigation, showToast]);

  const jumpToInquiry = (inquiryId: string) => {
    rememberList();
    if (!activeInquiry) {
      const saved = listPositions.current.get(listKey);
      listPositions.current.set(listKey, {top:saved?.top ?? 0,id:inquiryId});
    }
    setFocusedInquiryId(null);
    updateWorkspace(current => ({ ...current, activeInquiryId: inquiryId, visitedInquiryIds: rememberInquiry(current, inquiryId), activeTab: undefined }));
    setMobilePanelOpen(true); openResultPanel();
    setMobileSidebarOpen(false);
    locateInquiry(inquiryId);
  };

  const openAnchor = (id: string) => {
    const target = preferredInquiry(workspaceRef.current, id);
    if (target) jumpToInquiry(target.id);
  };

  const handleArticleClick = useCallback(
    (event: MouseEvent<HTMLElement>) => {
      const target = event.target as HTMLElement;
      const mark = target.closest<HTMLElement>("mark[data-inquiry-id]");
      if (mark?.dataset.inquiryId) openAnchor(mark.dataset.inquiryId);
    },
    [openAnchor],
  );

  return (
    <div
      className={`app-frame ${bookmarksOpen ? "bookmarks-mode" : ""} ${!sidebar.pinned ? "sidebar-collapsed" : ""} ${sidebar.peek ? "sidebar-peek" : ""} ${!resultPanel.expanded ? "result-collapsed" : ""} ${mobileSidebarOpen ? "sidebar-open" : ""} ${mobilePanelOpen ? "panel-open" : ""}`}
      onDragEnter={(event) => {
        event.preventDefault();
        setIsDragging(true);
      }}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={(event) => {
        if (event.currentTarget === event.target) setIsDragging(false);
      }}
      onDrop={handleDrop}
      onKeyDown={event => { if (event.key === "Escape" && !event.defaultPrevented) {
        if (providerOpen || selectionDraft || bookmarkDraft) return;
        if (deleteMode) { setDeleteMode(false); setPendingDeleteId(null); document.getElementById("inquiry-delete-toggle")?.focus(); return; }
        sidebar.close(); resultPanel.close(); sidebarDrawer.close(); resultDrawer.close(); } }}
    >
      <input
        ref={fileInputRef}
        type="file"
        accept={HOSTED?".pdf,.md,.markdown,.focus,.json,.gotit":".pdf,.md,.focus,.json,application/pdf,text/markdown,application/json"}
        aria-label="打开 PDF、Markdown 或阅读文档"
        hidden
        onChange={handleFileChange}
      />

      <div className="sidebar-rail" onMouseEnter={sidebar.reveal} onMouseLeave={sidebar.leave}><button type="button" className="icon-button" aria-label="展开导航" aria-controls="document-navigation" aria-expanded={sidebar.peek} onClick={sidebar.reveal}><PanelLeftOpen size={17} /></button></div>
      <aside id="document-navigation" ref={sidebar.ref} className="left-sidebar" aria-label="文档导航" inert={(resultPanel.narrow && mobilePanelOpen) || (sidebar.narrow ? !mobileSidebarOpen : !sidebar.pinned && !sidebar.peek)} onMouseEnter={sidebar.cancel} onMouseLeave={sidebar.leave} onBlur={sidebar.leave}>
        <div className="brand-row">
          <BrandMark />
          <div>
            <strong>got it</strong>
          </div>
          <div className="desktop-sidebar-controls">
            {<button className="icon-button" type="button" aria-label={sidebar.pinned ? "解除固定导航" : "固定导航"} aria-pressed={sidebar.pinned} title={sidebar.pinned ? "解除固定，移开后收起" : "固定导航"} onClick={e => { sidebar.pin(!sidebar.pinned); if(sidebar.pinned && e.detail>0)e.currentTarget.blur(); }}><Pin size={15} fill={sidebar.pinned ? "currentColor" : "none"} /></button>}
          </div>
          <button
            className="icon-button sidebar-close"
            type="button"
            aria-label="关闭导航"
            onClick={() => sidebarDrawer.close()}
          >
            <X size={16} />
          </button>
        </div>

        <ReadingLibraryNavigation library={library} importCopy={() => fileInputRef.current?.click()} />

        <nav className="sidebar-scroll">
          <section className="nav-section">
            {HOSTED?<details className="hosted-sample-picker" open={workspace.document.isDemo}><summary className="disclosure-summary"><span>公开样例</span><ChevronDown size={13} className="disclosure-chevron" aria-hidden="true"/></summary><HostedSamples onOpen={library.importFile}/></details>:null}
          {workspace.document.kind === "pdf" && library.entry ? <PdfOutline key={library.entry.id+workspace.document.pdf.resourceId+documentLoadId} entryId={library.entry.id} fileHash={workspace.document.pdf.resourceId} pages={workspace.document.pdf.pages.length} currentPage={pdfCurrentPage} readOnly={library.readOnly} onJump={item=>{bookmarkPreparing.current=null;setBookmarkTarget(null);setBookmarksOpen(false);setPdfDirectoryTarget({documentId:workspace.document.id,item,nonce:Date.now()});setMobileSidebarOpen(false);}}/> : <>
            <div className="section-label">
              <span>{workspace.document.kind === "pdf" ? "PDF 原页" : "文档结构"}</span>
              <span>{workspace.document.kind === "pdf" ? `${workspace.document.pdf.pages.length} 页` : rendered.outline.length}</span>
            </div>
            {workspace.document.kind === "pdf" ? <p className="nav-empty">向下滚动阅读后续页面。页面自动适合宽度，收起左栏可扩大阅读空间。</p> : !rendered.outline.length ? <p className="nav-empty" role="status">本文暂无标题目录。</p> : null}
            <div className="outline-list">
              {rendered.outline.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={`outline-item level-${item.level}`}
                  title={item.text}
                  aria-current={currentHeading === item.id ? "location" : undefined}
                  onClick={() => {
                    jumpToHeading(item.id);
                  }}
                >
                  {item.text}
                </button>
              ))}
            </div>
            </>}
          </section>

        </nav>
        <div className="sidebar-bookmark-footer"><button type="button" className="bookmarks-nav" aria-pressed={bookmarksOpen} disabled={!library.ready||library.busy} onClick={()=>void openBookmarks()}><Bookmark size={16} aria-hidden="true"/>全部收藏</button></div>
      </aside>

      <main className="reader-column" aria-hidden={bookmarksOpen||undefined} inert={bookmarksOpen||(sidebar.narrow && mobileSidebarOpen) || (resultPanel.narrow && mobilePanelOpen)}>
        <header className="reader-toolbar">
          <div className="toolbar-title">
            <button
              className="icon-button drawer-navigation-trigger"
              ref={sidebarDrawer.triggerRef}
              type="button"
              aria-label="打开导航"
              aria-controls="document-navigation"
              aria-expanded={sidebar.narrow && mobileSidebarOpen}
              onClick={() => setMobileSidebarOpen(true)}
            >
              <PanelLeftOpen size={18} />
            </button>
            <FileText size={15} />
            <div>
              <strong title={workspace.document.filename}>{workspace.document.filename}</strong>
              <span className="document-metadata">{workspace.document.isDemo ? "示例文档" : workspace.document.kind === "web" ? (workspace.document.web.retrieval?.provider === "fxtwitter" ? "X 公开接口保存副本" : workspace.document.web.extractorVersion === "x-browser-visible-v1" ? "X 页面保存副本" : workspace.document.web.coverage === "public-excerpt" ? "网页公开部分副本" : "网页保存副本") : (HOSTED?"浏览器阅读副本":"本地文档")} · {workspace.document.kind === "pdf" ? `${workspace.document.pdf.pages.length} 页 PDF` : workspace.document.markdown.length < 1000 ? `${workspace.document.markdown.length} 字符` : `${Math.round(workspace.document.markdown.length / 1000)}k 字符`}{readingMinutes !== null ? <span className="reading-time"> · 预计阅读 {readingMinutes} 分钟</span> : null}</span>
            </div>
          </div>

          <div className="toolbar-actions">
          <DocumentBookmarks bookmarks={documentBookmarks.bookmarks} loading={documentBookmarks.loading} error={documentBookmarks.error} revisionId={activeBookmarkRevision} disabled={!library.entry||library.busy} onLocate={locateBookmark} onRetry={bookmarkFeedback.changed} onChanged={bookmarkFeedback.changed}/>
            <div className="provider-control" ref={providerControlRef}>
              <button
                className="provider-trigger"
                title="AI 连接与模型设置"
                aria-label="AI 连接与模型设置"
                type="button"
                aria-expanded={providerOpen}
                onClick={() => {setProviderOpen((value) => !value);if(HOSTED)void refreshProviders();}}
              >
                <ProviderGlyph id={activeProvider.id} />
                <span>{activeProvider.name}</span>
                <span className={`connection-dot ${activeProvider.availability}`} />
                <ChevronDown size={13} />
              </button>
              <div className="provider-shell" hidden={!providerOpen}>
                <ProviderPopover
                  providers={providers}
                  activeProviderId={workspace.activeProviderId}
                  onSelect={selectProvider}
                  onClose={() => setProviderOpen(false)}
                >
          {HOSTED?<HostedSettings key={String(providerOpen)}/>:<><CodexLogin provider={activeProvider} onConnected={onCodexConnected} />
          <details className="model-settings" open onToggle={event => { if (event.currentTarget.open) void refreshModels(true); }}>
          <summary>模型设置</summary><div className="model-controls">
            <label className="settings-purpose">用途<select aria-label="设置用途" value={settingsIntent} onChange={e => setSettingsIntent(e.target.value as InquiryIntent)}>{NEW_INQUIRY_INTENTS.map(intent => <option key={intent} value={intent}>{INTENT_META[intent].label}</option>)}</select></label>
            {workspace.activeProviderId === "codex" ? <>
              <label>模型<select aria-label="当前用途的模型" disabled={modelsLoading || !!modelsError} value={currentModel.model} onChange={e => {
                const model = codexModels.find(m => m.model === e.target.value);
                if (model) changeModel({ model: model.model, reasoningEffort: model.supportedReasoningEfforts.some(e => e.reasoningEffort === currentModel.reasoningEffort) ? currentModel.reasoningEffort : model.defaultReasoningEffort });
              }}>
                {!selectedModelInfo ? <option value={currentModel.model} disabled>{currentModel.model}（{modelsLoading ? "加载中" : "目录暂不可用"}）</option> : null}
                {codexModels.map(model => <option key={model.model} value={model.model}>{model.displayName}</option>)}
              </select></label>
              <label>推理强度<select aria-label="当前用途的推理强度" disabled={modelsLoading || !!modelsError || !selectedModelInfo} value={currentModel.reasoningEffort} onChange={e => changeModel({ ...currentModel, reasoningEffort: e.target.value })}>
                {!selectedModelInfo?.supportedReasoningEfforts.some(e => e.reasoningEffort === currentModel.reasoningEffort) ? <option value={currentModel.reasoningEffort} disabled>{currentModel.reasoningEffort}</option> : null}
                {selectedModelInfo?.supportedReasoningEfforts.map(effort => <option key={effort.reasoningEffort} value={effort.reasoningEffort} title={effort.description}>{effort.reasoningEffort}</option>)}
              </select></label>
              {!modelsLoading && !modelsError && !supportsConfig(codexModels, currentModel) ? <small role="status">当前目录不支持 {currentModel.model} / {currentModel.reasoningEffort}；已保留设置，不会自动换模型。</small> : null}
              <button type="button" className="refresh-models" disabled={modelsLoading} onClick={() => void refreshModels(true)}>{modelsLoading ? "正在刷新…" : modelsError ? "重试读取模型" : "刷新模型列表"}</button>
              {modelsError ? <small role="alert">{modelsError}</small> : null}
            </> : <small>当前使用 {activeProvider.name}，模型由该连接配置。</small>}
          </div>
          </details></>}
                </ProviderPopover>
              </div>
            </div>
            <button
              className="icon-button drawer-results-trigger"
              ref={resultDrawer.triggerRef}
              type="button"
              aria-label="打开知识贴"
              aria-controls="knowledge-panel"
              aria-expanded={resultPanel.narrow && mobilePanelOpen}
              onClick={() => setMobilePanelOpen(true)}
            >
              <PanelRightOpen size={18} />
            </button>
          </div>
        </header>

        <div className={`reader-tools${HOSTED ? " reader-tools--hosted" : ""}${workspace.document.kind === "web" ? " reader-tools--web" : ""}`}>
        <ReadingLibraryStatus library={library} hideWebSource={workspace.document.kind === "web"} onImport={() => fileInputRef.current?.click()} />
        <WebTranslationControls key={workspace.document.id+":"+documentLoadId} workspace={workspace} library={library} saveStatus={saveStatus} onSide={side => { setSelectionDraft(null);setBookmarkDraft(null);setInquirySelectionError('');window.getSelection()?.removeAllRanges(); const position = capturePosition();updateWorkspace(current=>({...current,readingSide:side})); requestAnimationFrame(()=>restorePosition(position)); }} />
        <div ref={setPdfToolbarHost} className="reader-status-host" />
        {workspace.document.kind !== "pdf" && workspace.document.kind !== "web" ? <div className="markdown-toolbar"><div className="markdown-toolbar-row"><div className="library-save-status" role="status">{saveStatus}{library.busy ? " · 正在处理…" : ""}</div></div></div> : null}
        <div ref={setAdjustmentHost} className="reader-adjustment-layer">
          {workspace.document.kind !== "pdf" ? <div key={workspace.document.id+":"+documentLoadId} className="reading-adjustment-dock"><MarkdownWidthControls width={markdownWidth.width} onChange={markdownWidth.change}/></div> : null}
        </div>
        </div>
        <div className="reader-viewport" ref={readerViewportRef}>
        <div key={workspace.document.id+":"+documentLoadId} className={`reader-scroll${workspace.document.kind === "pdf" ? " reader-scroll--pdf" : ""}`} onScroll={() => { if (!markdownWidth.adjusting.current) library.scrolled(); }}>
          {workspace.document.isDemo && !HOSTED ? (
            <div className="demo-document-note">
              <Sparkles size={15} />
              <span><strong>可直接体验：</strong>选中 “CAGR” 或 “67% 的 35 岁以下成人”，再选择一种追问方式。</span>
              <button type="button" onClick={() => void library.choose()}>换成我的文档</button>
            </div>
          ) : null}
          {workspace.document.kind === "pdf" && library.entry ? <Suspense fallback={<p className="pdf-status">正在加载 PDF 阅读器…</p>}><PdfReader translation={workspace.webTranslation} showTranslation={workspace.readingSide==="translated"} toolbarHost={pdfToolbarHost} adjustmentHost={adjustmentHost} onReadingTime={receivePdfMinutes} outlineTarget={pdfDirectoryTarget?.documentId===workspace.document.id?pdfDirectoryTarget:null} onCurrentPage={setPdfCurrentPage} key={workspace.document.id+documentLoadId} document={workspace.document} revisionId={library.entry.revisionId} onBookmarkSaved={finishBookmarkSave} bookmarkCompleted={bookmarkCompleted} bookmarks={currentBookmarks} bookmarkVersion={bookmarkVersion} onBookmarkStarted={beginBookmarkSave} onBookmarkFailed={bookmarkFeedback.failed} bookmarkTarget={bookmarkTarget} onBookmarkLocated={success=>{if(!bookmarkTarget||bookmarkPreparing.current?.nonce!==bookmarkTarget.locateNonce)return;bookmarkPreparing.current=null;if(!success){showToast("无法定位收藏原文，摘录仍保留。");setBookmarksOpen(true);}else setBookmarksOpen(false);setBookmarkTarget(null);}} entryId={library.entry.id} inquiries={workspace.inquiries} activeId={workspace.activeInquiryId} target={pdfTarget} onLocated={finishSourceNavigation} initialPosition={library.initialPosition} readOnly={library.readOnly} saveStatus={saveStatus} saveBusy={library.busy} saveError={library.blocked||library.status==="阅读进度暂未保存"} onCreate={createInquiry} onActivate={openAnchor} onReady={library.rendered} onView={library.scrolled}/></Suspense> : <article
            ref={articleRef}
            className="markdown-article"
            data-reading-side={workspace.readingSide ?? "original"}
            data-translation-id={workspace.webTranslation?.id}
            data-translation-version={workspace.webTranslation?.version}
            style={{ width: `min(100%, max(360px, ${markdownWidth.width}%))` }}
            onMouseUp={handleArticleMouseUp}
            onClick={handleArticleClick}
            dangerouslySetInnerHTML={{ __html: rendered.html }}
          />}
          <footer className="reader-footer">
            <BookOpenText size={15} />
            <span>读到不懂处，选中原文。一次只解决一个知识缺口。</span>
          </footer>
        </div>
        </div>
      </main>

      {workspace.document.kind === "web" ? <><WebImageViewer article={articleRef} documentKey={workspace.document.id+":"+documentLoadId}/><WebMediaRetry key={workspace.document.id+":"+documentLoadId+":"+library.historyId} article={articleRef} web={workspace.document.web} documentKey={workspace.document.id+":"+documentLoadId+":"+rendered.html} disabled={library.readOnly||!library.ready} retry={library.retryWebMedia}/></> : null}
      <div className="result-rail" onMouseEnter={resultPanel.hoverReveal} onMouseLeave={resultPanel.leave}>
        <button ref={resultPanel.triggerRef} type="button" className="icon-button" aria-label="展开知识贴" aria-controls="knowledge-panel" aria-expanded={resultPanel.expanded} onClick={resultPanel.reveal}><PanelRightOpen size={17} /></button>
      </div>
      <aside id="knowledge-panel" ref={resultPanel.ref} className="right-panel" aria-label="活动知识贴" aria-hidden={bookmarksOpen||undefined} inert={bookmarksOpen||(sidebar.narrow && mobileSidebarOpen) || (resultPanel.narrow ? !mobilePanelOpen : !resultPanel.expanded)} onMouseEnter={resultPanel.enter} onMouseLeave={resultPanel.leave} onFocus={resultPanel.cancel} onBlur={resultPanel.deferClose}>
        <PanelResizeHandle panel={resultPanel.ref} onStart={resultPanel.openReading} onCollapse={resultPanel.collapseFromDrag} />

        <div className="panel-mobile-head">
          <span>活动知识贴</span>
          <button className="icon-button" type="button" aria-label="关闭知识贴" onClick={() => resultDrawer.close()}>
            <X size={17} />
          </button>
        </div>
        <div className="panel-desktop-head">
          <div className="desktop-panel-controls">
            <button className="icon-button" type="button" aria-label={resultPanel.pinned ? "解除固定知识贴" : "固定知识贴"} aria-pressed={resultPanel.pinned} title={resultPanel.pinned ? "解除固定，移开后收起" : "固定知识贴"} onClick={event => { resultPanel.pin(!resultPanel.pinned); if (resultPanel.pinned && event.detail > 0) event.currentTarget.blur(); }}><Pin size={15} fill={resultPanel.pinned ? "currentColor" : "none"} /></button>
          </div>
          <div className="inquiry-tabs" role="tablist" aria-label="本文知识贴分类">
            {NEW_INQUIRY_INTENTS.map((intent, index) => {
              const items = intentHistory(workspace.inquiries, intent);
              const Icon = INTENT_ICONS[intent];
              const busy = items.some(i => i.status === "answering");
              return <button key={intent} id={`intent-tab-${intent}`} data-intent={intent} aria-label={`${INTENT_META[intent].label}${items.length ? `(${items.length})` : ""}`} title={`${INTENT_META[intent].label} · ${items.length} 条${busy ? " · 处理中" : ""}`} type="button" role="tab" aria-selected={tabIntent === intent} aria-busy={busy} aria-controls="intent-result" tabIndex={tabIntent === intent || (tabIntent === "why" && index === 0) ? 0 : -1}
                onClick={() => switchTab(intent)} onKeyDown={event => {
                  const tabs=NEW_INQUIRY_INTENTS,active=tabs.indexOf(intent);
                  const next = event.key === "ArrowRight" ? (active + 1) % tabs.length : event.key === "ArrowLeft" ? (active + tabs.length-1) % tabs.length : event.key === "Home" ? 0 : event.key === "End" ? tabs.length-1 : -1;
                  if (next < 0) return; event.preventDefault(); switchTab(tabs[next]); document.getElementById(`intent-tab-${tabs[next]}`)?.focus();
                }}><Icon size={14} aria-hidden="true" /><span className="tab-label">{INTENT_META[intent].label}</span>{items.length > 0 ? <span className="tab-count">({items.length > 99 ? "99+" : items.length})</span> : null}{busy ? <i className="tab-busy" aria-label="处理中" /> : null}</button>;
            })}
          </div>
        </div>
        {!resultPanel.pinned ? <button className="result-collapse-action icon-button" type="button" aria-label="收起知识贴" title="收起知识贴（Esc）" onClick={resultPanel.close}><PanelRightClose size={15} /></button> : null}
        <div ref={listScrollRef} onScroll={rememberList} className={`intent-result${activeInquiry ? "" : " category-view"}`} id="intent-result" role="tabpanel" aria-labelledby={tabIntent !== "why" ? `intent-tab-${tabIntent}` : undefined}>
        {activeInquiry ? <div className="result-navigation">{activeInquiry.anchor.translation ? <button type="button" className="source-excerpt" onClick={()=>{if(activeInquiry.anchor.translation?.translationId!==workspace.webTranslation?.id || activeInquiry.anchor.translation?.version!==workspace.webTranslation?.version){showToast("旧译文摘录仍保留；当前译文版本不同，请用对应原文段落回看。");return;}updateWorkspace(current=>({...current,readingSide:"translated"}));requestAnimationFrame(()=>locateInquiry(activeInquiry.id,true));}}>译文摘录：{activeInquiry.anchor.translation.quote}</button> : null}<button className="return-to-list" type="button" onClick={() => switchTab(tabIntent, true)}><ChevronLeft size={16} aria-hidden="true" />返回</button>{activeInquiry.anchor.scope === "document" ? <span className="source-excerpt">全文</span> : <button className="source-excerpt" type="button" title={activeInquiry.anchor.quote} aria-label={`定位原文：${activeInquiry.anchor.pdf?.kind === 'region' ? `第 ${activeInquiry.anchor.pdf.page} 页 · 所选区域` : activeInquiry.anchor.quote}`} onClick={() => { track("source-return"); if(activeInquiry.anchor.translation)updateWorkspace(current=>({...current,readingSide:"original"}));requestAnimationFrame(()=>locateInquiry(activeInquiry.id, true)); }}>{activeInquiry.anchor.pdf ? <span className="source-page">第 {activeInquiry.anchor.pdf.page} 页{activeInquiry.anchor.pdf.kind === 'region' ? ' · 所选区域' : ''}</span> : null}{activeInquiry.anchor.pdf?.kind !== 'region' ? <span>{activeInquiry.anchor.translation?"对应原文段落：":""}{activeInquiry.anchor.quote}</span> : null}</button>}</div> : null}
          <div hidden={!!activeInquiry} className="category-heading category-toolbar"><strong>本文的{tabIntent === "ask" ? "问题" : INTENT_META[tabIntent].shortLabel}</strong><div className="category-heading-actions"><span>{categoryItems.length} 条</span>
            <button id="inquiry-delete-toggle" className="category-delete-toggle" type="button" aria-label={deleteMode ? "退出删除模式" : "删除知识贴"} title={deleteMode ? "退出删除模式（Esc）" : "删除知识贴"} aria-pressed={deleteMode}
              disabled={!categoryItems.length || library.readOnly || library.busy || !library.ready}
              onClick={() => { setDeleteMode(value => !value); setPendingDeleteId(null); }}><Trash2 size={16} aria-hidden="true" /></button>
          </div></div>
        <nav hidden={!!activeInquiry} className="category-items" aria-label={`${INTENT_META[tabIntent].label}条目`}>
          {categoryItems.length ? categoryItems.map(item => <div className="category-row" key={item.id}>
            <button className="category-open" type="button" data-inquiry-id={item.id} aria-current={activeInquiry?.id === item.id ? "true" : undefined} onFocus={() => setFocusedInquiryId(item.id)} onBlur={() => setFocusedInquiryId(null)} onClick={() => jumpToInquiry(item.id)}>
              <span>{item.intent === "ask" ? item.question : selectedQuote(item.anchor)}{item.intent === "ask" ? <small className="question-anchor">{selectedQuote(item.anchor)}</small> : null}</span><small>{inquiryCategoryStatus(item)}</small>{categoryItems.filter(other => other.anchor.quote === item.anchor.quote).length > 1 ? <small className="inquiry-identity">{new Date(item.messages.at(-1)?.createdAt ?? item.updatedAt).toLocaleDateString()} · {(item.messages.filter(message => message.role === "assistant").at(-1)?.content || item.question).replace(/[#*_`]/g, "").slice(0, 56)}</small> : null}
            </button>
            {deleteMode ? <button className={`category-delete${pendingDeleteId === item.id ? " confirming" : ""}`} type="button" data-delete-inquiry-id={item.id}
              aria-label={`${pendingDeleteId === item.id ? "确认删除知识贴" : "删除知识贴"}：${item.anchor.quote}`}
              title={pendingDeleteId === item.id ? "再次点击，删除此知识贴及全部回答" : "删除此知识贴"}
              onClick={() => deleteInquiry(item.id)}>{pendingDeleteId === item.id ? <><Check size={16} aria-hidden="true" /><span>确认删除</span></> : <Trash2 size={16} aria-hidden="true" />}</button> : null}
          </div>) : <p>{tabIntent === "ask" ? "可以向全文提问，也可以选中原文问一问。" : <>还没有{INTENT_META[tabIntent].label}条目。在原文选中文字，再选择“{INTENT_META[tabIntent].label}”即可创建。</>}</p>}
          {tabIntent === "ask" ? <div className="document-question-entry">
            {HOSTED?<HostedSendDisclosure/>:null}
            {documentQuestionOpen ? <QuestionComposer initialOpen disabled={documentQuestionBusy || library.readOnly || library.busy || !library.ready || !modelReady} onClose={() => setDocumentQuestionOpen(false)} onSubmit={question => createInquiry("ask", { anchor: documentAnchor(workspace.document), context: "", rect: { top: 0, left: 0, width: 0, height: 0 } }, question)} /> : <button className="document-question-trigger" type="button" disabled={documentQuestionBusy || library.readOnly || library.busy || !library.ready || !modelReady} onClick={() => setDocumentQuestionOpen(true)}><span aria-hidden="true">＋</span>向全文提问</button>}
          </div> : null}
        </nav>
        {activeInquiry && activeInquiry.anchor.scope !== "document" && group.length > 1 ? <nav className="anchor-requests" aria-label="这处原文的已有结果"><small>这处原文</small>{(['explain','verify','ask','why'] as InquiryIntent[]).flatMap(intent => {
          const items = intentHistory(group, intent);
          const remembered = intent === 'ask' ? [...(workspace.visitedInquiryIds ?? [])].reverse().map(id => items.find(i => i.id === id)).find(Boolean) : undefined;
          const visible = (remembered ? [remembered] : items).slice(0, 1);
          return visible.map(item => <button type="button" key={item.id} title={intent === 'ask' ? '我的问题' : INTENT_META[intent].shortLabel} aria-current={categoryIntent(activeInquiry.intent) === intent ? 'true' : undefined} onClick={() => { if (categoryIntent(activeInquiry.intent) !== intent) jumpToInquiry(item.id); }}>{intent === 'ask' ? '我的问题' : INTENT_META[intent].shortLabel}</button>);
        })}</nav> : null}
        {activeInquiry ? (
          <InquiryPanel
            key={activeInquiry.id}
            inquiry={activeInquiry}
            groupBusy={groupBusy || library.readOnly || library.busy}
            groupGenerating={groupBusy}
            modelReady={modelReady && !library.readOnly && !library.busy}
            onCancel={cancelInquiry}
            provider={activeProvider}
            onFollowUp={submitFollowUp}
            onQuestion={submitCustomQuestion}
            onRetry={retryInquiry}
            progress={progress[activeInquiry.id]}
            relatedHistory={history.length > 1 && tabIntent !== "ask" && tabIntent !== "verify" ? <details className="answer-history related-history"><summary>同处原文的历史记录</summary><label className="history-picker">历史记录<select aria-label="历史记录" value={activeInquiry.id} onChange={e => jumpToInquiry(e.target.value)}>{history.map(i => <option key={i.id} value={i.id}>{new Date(i.updatedAt).toLocaleString()} · {i.question}</option>)}</select></label></details> : null}
          />
        ) : (
          categoryItems.length ? <div className="empty-intent"><p>选择上方条目查看结果。</p></div> : null
        )}
        </div>
      </aside>

      {bookmarksOpen?<BookmarksView onChanged={bookmarkFeedback.changed} version={bookmarkVersion} onClose={closeBookmarks} onLocate={locateBookmark}/>:null}
      {bookmarkFailure?<div className="bookmark-toast" role="alert"><span>收藏失败：{bookmarkFailure.error}（{bookmarkQuote(bookmarkFailure.request.anchor).slice(0,36)}）</span><button type="button" disabled={bookmarkRetrying} onClick={()=>void bookmarkFeedback.retry(finishBookmarkSave)}>{bookmarkRetrying?'保存中…':'重试收藏'}</button><button type="button" onClick={bookmarkFeedback.closeFailure}>关闭</button></div>:null}
      <span className="bookmark-live" role="status" aria-live="polite">{bookmarkNotice?'已收藏':''}</span>
      {bookmarkDraft && !bookmarksOpen ? (
        <SelectionToolbar
          draft={bookmarkDraft}
          hint={inquirySelectionError}
          bookmark={(library.entry||HOSTED)&&!library.readOnly?<BookmarkAction prepareEntry={!library.entry?library.ensureEntry:undefined} entryId={library.entry?.id??""} revisionId={library.entry?.revisionId??""} anchor={bookmarkDraft.anchor} iconOnly onSaved={finishBookmarkSave} version={bookmarkVersion} onStarted={beginBookmarkSave} onFailed={bookmarkFeedback.failed}/>:null}
          onSelect={(intent, question) => createInquiry(intent, undefined, question)}
          disabled={!selectionDraft || !modelReady || workspace.inquiries.some(i => i.status === "answering" && sameAnchor(i.anchor, selectionDraft.anchor)) || library.readOnly || library.busy}
          onClose={() => {
            setSelectionDraft(null);setBookmarkDraft(null);setInquirySelectionError('');
            window.getSelection()?.removeAllRanges();
          }}
        />
      ) : null}

      {isDragging ? (
        <div className="drop-overlay">
          <div>
            <Upload size={24} />
            <strong>放下 PDF、Markdown 或阅读文档</strong>
            <span>当前文档不会被修改</span>
          </div>
        </div>
      ) : null}

      {(sidebar.narrow && mobileSidebarOpen) || (resultPanel.narrow && mobilePanelOpen) ? (
        <button
          className="mobile-scrim"
          type="button"
          aria-label="关闭面板"
          onClick={() => {
            // The right drawer sits above the left one when both are open.
            sidebarDrawer.close(!mobilePanelOpen);
            resultDrawer.close(true);
          }}
        />
      ) : null}

      {toast ? <div className="toast" role="status">{toast}</div> : null}
    </div>
  );
}

function BrandMark() {
  return (
    <img className="brand-mark" src={brandIcon} width={29} height={29} alt="" aria-hidden="true" />
  );
}

function ProviderGlyph({ id }: { id: ProviderId }) {
  if (id === "codex") return <Terminal size={15} />;
  if (id === "deepseek") return <Bot size={15} />;
  return <Sparkles size={15} />;
}

interface ProviderPopoverProps {
  children?: ReactNode;
  providers: ProviderStatus[];
  activeProviderId: ProviderId;
  onSelect: (provider: ProviderStatus) => void;
  onClose: () => void;
}

function ProviderPopover({
  children,
  providers,
  activeProviderId,
  onSelect,
  onClose,
}: ProviderPopoverProps) {
  return (
    <div className="provider-popover">
      <div className="popover-head">
        <div>
          <strong>AI 设置</strong>
        </div>
        <button className="icon-button" type="button" onClick={onClose} aria-label="关闭 AI 设置"><X size={14} /></button>
      </div>

      <div className="provider-list">
        {providers.map((provider) => (
          <button
            key={provider.id}
            className={`provider-option ${provider.id === activeProviderId ? "active" : ""}`}
            type="button"
            onClick={() => onSelect(provider)}
          >
            <span className="provider-option-icon"><ProviderGlyph id={provider.id} /></span>
            <span className="provider-option-copy">
              <strong>{provider.name}{provider.localOnly ? <em>本地</em> : null}</strong>
              <small>{provider.detail || provider.description}</small>
            </span>
            {provider.availability === "connected" && provider.id === activeProviderId ? <Check size={15} /> : (
              <span className={`availability-label ${provider.availability}`}>
                {provider.availability === "connected" ? "已连接" : provider.availability === "checking" ? "检查中" : "未连接"}
              </span>
            )}
          </button>
        ))}
      </div>

      {children}
    </div>
  );
}

function SelectionToolbar({
  draft,
  onSelect,
  onClose,
  disabled,
  bookmark,
  hint,
}: {
  draft: BookmarkDraft;
  hint?:string;
  bookmark?: ReactNode;
  onSelect: (intent: ActiveInquiryIntent, question?: string) => void;
  disabled?: boolean;
  onClose: () => void;
}) {
  const left = Math.min(
    Math.max(draft.rect.left + draft.rect.width / 2, 238),
    window.innerWidth - 238,
  );
  const top = Math.min(draft.rect.top + draft.rect.height + 12, Math.max(12, window.innerHeight - 320));
  return (
    <div
      className="selection-toolbar selection-surface"
      style={{ left, top }}
      onMouseDown={(event) => { if (!(event.target instanceof HTMLTextAreaElement)) event.preventDefault(); }}
    >
      <div className="selection-understanding"><div className="selection-quote">“{bookmarkQuote(draft.anchor)}”</div>
      {hint?<p className="bookmark-selection-hint">{hint}</p>:null}
      <SelectionActions bookmark={bookmark} onSelect={onSelect} onClose={onClose} disabled={disabled}/></div>
    </div>
  );
}

interface InquiryPanelProps {
  onCancel: () => void;
  modelReady: boolean;
  groupBusy: boolean;
  groupGenerating: boolean;
  inquiry: Inquiry;
  provider: ProviderStatus;
  onFollowUp: (action: Refinement) => void;
  onRetry: () => void;
  onQuestion: (question: string) => void;
  progress?: string;
  relatedHistory?: ReactNode;
}

function InquiryPanel({
  onCancel,
  modelReady,
  groupBusy,
  groupGenerating,
  inquiry,
  provider,
  onFollowUp,
  onRetry,
  onQuestion,
  progress,
  relatedHistory,
}: InquiryPanelProps) {
  const latestAssistant = [...inquiry.messages]
    .reverse()
    .find((message) => message.role === "assistant");

  const actionsEnabled = !groupBusy && canCompleteInquiry(inquiry);
  const latestRequestFailed = !!(inquiry.lastError || latestAssistant?.completion === "interrupted" || latestAssistant?.verification?.completion === "interrupted" || latestAssistant?.search?.status === "failed");
  const verificationRetryVisible = inquiry.intent === "verify" && inquiry.status !== "answering" && latestRequestFailed;
  const recheckDisabledReason = groupBusy ? "当前请求正在进行，请等待完成或先停止" : !modelReady ? "请先连接可用模型" : !provider.supportsWebSearch ? "当前提供方不支持联网查找来源，请切换支持搜索的提供方" : undefined;
  const followUpDisabledReason = groupBusy ? "当前请求正在进行，请等待完成或先停止" : !modelReady ? "请先连接可用模型" : !actionsEnabled ? "需要完整回答后才能继续；失败或中断时请重试" : undefined;
  const threadRef = useRef<HTMLDivElement>(null);
  // Reset only for a new reply, never for streaming chunks or completion changes.
  useLayoutEffect(() => { if (threadRef.current) threadRef.current.scrollTop = 0; }, [inquiry.id, latestAssistant?.id]);

  return (
    <div className="inquiry-panel-content">
      <div className="thread-scroll" ref={threadRef}>
        {inquiry.anchor.matchStatus === "needs-relink" ? <p className="anchor-warning">原文位置需要重新确认</p> : null}
        {inquiry.intent === "ask" ? <div className="current-question"><small>我的问题{inquiry.anchor.scope === "document" ? " · 全文" : ""}</small><h2>{[...inquiry.messages].reverse().find(m => m.role === "user")?.content ?? inquiry.question}</h2></div> : null}
        <div className="thread-messages">
          {latestAssistant ? <AssistantMessage message={latestAssistant} failure={inquiry.lastError} verification={inquiry.intent === "verify"} entity={inquiry.intent === "entity"} /> : null}
          {inquiry.status === "answering" && latestAssistant ? <RequestStatus key={latestAssistant.requestId ?? latestAssistant.id} startedAt={latestAssistant.createdAt} hasText={!!latestAssistant.content.trim()} progress={progress} /> : null}
          {latestAssistant?.mode === "demo" && inquiry.status !== "answering" ? (
            <button className="secondary-action" type="button" onClick={onRetry}><RefreshCw size={13} /> 用真实模型回答</button>
          ) : null}
          {inquiry.lastError && !(latestAssistant && (latestAssistant.operation ? latestAssistant.operation === "verify" : inquiry.intent === "verify")) ? (
            <div className={inquiry.lastError.startsWith("已停止") ? "stopped-card" : "error-card"}>
              <CircleAlert size={16} />
              <div><strong>{inquiry.lastError.startsWith("已停止") ? "你已停止生成" : inquiry.intent === "verify" ? "查找失败" : "请求失败"}</strong><p>{inquiry.lastError}</p></div>
            </div>
          ) : null}
        </div>

      <footer className="inquiry-actions compact-actions">
        {verificationRetryVisible ? (
          <button className="secondary-action verify-again-action" type="button" disabled={!!recheckDisabledReason} title={recheckDisabledReason} aria-describedby={recheckDisabledReason ? "recheck-unavailable" : undefined} onClick={onRetry}>重试</button>
        ) : inquiry.intent === "entity" ? (
          <button type="button" className="secondary-action detail-introduction-action" disabled={!!followUpDisabledReason} title={followUpDisabledReason} aria-describedby={followUpDisabledReason ? "followup-unavailable" : undefined} onClick={() => onFollowUp("detail")}>
            详细介绍
          </button>
        ) : null}
        {inquiry.intent !== "verify" && inquiry.status !== "answering" && (inquiry.lastError || latestAssistant?.completion === "interrupted" || latestAssistant?.verification?.completion === "interrupted" || latestAssistant?.search?.status === "failed") ? (
          <button className="secondary-action regenerate-action" type="button" disabled={groupBusy} onClick={onRetry}><RefreshCw size={14} aria-hidden="true" />重新生成</button>
        ) : null}
        {inquiry.status === "answering" ? <button className="secondary-action stop-action" type="button" onClick={onCancel}>停止本次请求</button> : null}
      <QuestionComposer prompt={inquiry.intent === "explain" || inquiry.intent === "why" || inquiry.intent === "verify" ? "还是不懂？" : undefined} disabled={groupBusy || !modelReady} hideTrigger={inquiry.intent !== "ask" && (groupGenerating || latestRequestFailed)} followUp={inquiry.intent === "ask"} onSubmit={onQuestion} />
      </footer>
      {inquiry.intent === "entity" && followUpDisabledReason ? <p className="recheck-unavailable" id="followup-unavailable">{followUpDisabledReason}</p> : null}
      {verificationRetryVisible && recheckDisabledReason ? <p className="recheck-unavailable" id="recheck-unavailable">{recheckDisabledReason}</p> : null}
          {inquiry.intent !== "verify" && inquiry.messages.filter(message => message.role === "assistant" && message.id !== latestAssistant?.id).length ? <details className="answer-history"><summary>历史回答</summary>{inquiry.messages.filter(message => message.role === "assistant" && message.id !== latestAssistant?.id).map(message => <AssistantMessage key={message.id} message={message} history verification={inquiry.intent === "verify"} entity={inquiry.intent === "entity"} />)}</details> : null}
      {relatedHistory}
      </div>
    </div>
  );
}

export function AssistantMessage({ message, verification = false, entity = false, failure, history = false }: { message: ThreadMessage; verification?: boolean; entity?: boolean; failure?: string; history?: boolean }) {
  const isReview = message.operation ? message.operation === "verify" : verification;
  const isWebExplanation = !isReview && (message.explanationMode === "web" || (message.explanationMode === "auto" && (message.search?.status !== "not-executed" && message.search !== undefined || !!message.sources?.length)));
  const isIntroduction = message.operation ? message.operation === "entity" : entity;
  const websites = (message.sources ?? []).filter(source => safeSourceUrl(source.url)).filter((source, index, all) => all.findIndex(other => other.url === source.url) === index).sort((a, b) => Number(b.websiteRole === "official") - Number(a.websiteRole === "official"));
  const renderedAnswer = useMemo(() => renderMarkdown(message.content), [message.content]);
  return (
    <article className="assistant-message" data-message-id={message.id} data-completion={message.completion}>
      {isReview ? <VerificationAnswer message={message} failure={failure} history={history} /> : <>
      {message.mode === "demo" ? (
        <div className="demo-answer-label"><Info size={12} /> 演示回答 · 未调用真实模型</div>
      ) : null}
      {message.completion === "provisional" && !message.verification ? <p className="provisional-note" role="status">正在生成，内容尚未完成{message.operation === "verify" || message.operation === "entity" || isWebExplanation ? "；来源与结论尚未核对" : ""}。</p> : null}
      {message.completion === "interrupted" && !failure ? <p className="no-source-note">本轮中断，未收到最终结果。</p> : null}
      {message.contextNotice ? <p className="document-context-note">{message.contextNotice}</p> : null}
      <div className="answer-markdown" dangerouslySetInnerHTML={{ __html: renderedAnswer.html }} />
      {isWebExplanation ? <CompactSources message={message} answerHtml={renderedAnswer.html} /> : null}
      {isIntroduction && websites.length > 0 ? <nav className="website-links" aria-label="相关网站"><small>相关网站</small>{websites.map(source => <a key={source.id} href={safeSourceUrl(source.url)} target="_blank" rel="noopener noreferrer"><ExternalLink size={13} aria-hidden="true" /><span>{source.title}<small>{new URL(source.url).hostname}</small></span>{source.websiteRole === "official" ? <em>官网</em> : null}</a>)}</nav> : null}
      </>}
    </article>
  );
}

export function RequestStatus({ startedAt, hasText, progress }: { startedAt: string; hasText: boolean; progress?: string }) {
  const started = new Date(startedAt).getTime();
  const [clock, setClock] = useState(Date.now);
  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, []);
  const elapsed = Math.max(0, (clock - started) / 1000);
  const searching = progress?.includes("搜索") || progress?.includes("核对");
  return <>
    <div className="request-status"><span>{hasText ? "已用时" : progress ?? "正在处理"}</span><time aria-label="本次请求已用时间">{elapsed.toFixed(1)}s</time></div>
    {!hasText && elapsed >= 8 ? <div className="waiting-toast" role="status">请再稍等一下，我正在{searching ? "查找资料" : "整理答案"}…</div> : null}
  </>;
}

export default App;
