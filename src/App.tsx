import { CodexLogin } from "./CodexLogin";
import { useReadingLibrary } from "./useReadingLibrary";
import { ReadingLibraryNavigation, ReadingLibraryStatus } from "./ReadingLibraryView";
import { readDocumentFile } from "./lib/reading-document";
import { migrateHighlightAnchors } from "./lib/anchor-migration";
import { readingContext } from "./lib/reading-context";
import { anchorGroup, inquiryCategoryStatus, intentHistory, sameAnchor } from "./lib/inquiry-tabs";
import { modelConfig, resolveModelConfig, supportsConfig, type CodexModel, type ModelConfig } from "./lib/model-routing";
import { VerificationAnswer } from "./VerificationAnswer";
import { loadModelCatalog } from "./lib/model-catalog";
import { interruptMessage, PROGRESS_LABELS, readInquiryStream, responseMessage } from "./lib/inquiry-stream";
import { NEW_INQUIRY_INTENTS } from "./types";
import { safeSourceUrl } from "./lib/evidence";
import {
  BookMarked,
  BookOpenText,
  Bot,
  Check,
  ChevronDown,
  CircleAlert,
  CircleCheck,
  ExternalLink,
  FileText,
  Info,
  Lightbulb,
  Link2,
  LoaderCircle,
  Menu,
  PanelRightOpen,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  Terminal,
  Upload,
  Waypoints,
  X,
} from "lucide-react";
import {
  useCallback,
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
  STATUS_META,
  type Inquiry,
  type InquiryIntent,
  type InquiryRequest,
  type InquiryResponse,
  type ProviderId,
  type ProviderStatus,
  type SelectionDraft,
  type ThreadMessage,
  type Workspace,
} from "./types";
import { createInitialWorkspace } from "./sample";
import { REFINEMENTS, canCompleteInquiry, isVerificationUnfinished, type Refinement } from "./lib/learning";
import { renderMarkdown } from "./lib/markdown";
import {
  applyInquiryHighlights,
  emphasizeInquiryHighlight,
  findInquiryHighlight,
  createAnchorFromSelection,
} from "./lib/anchors";
import { loadWorkspace, saveWorkspace, restoreWorkspace } from "./lib/storage";

const FALLBACK_PROVIDERS: ProviderStatus[] = [
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
};


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
  const [workspace, setWorkspace] = useState<Workspace>(() => {
    let loaded = migrateHighlightAnchors(loadWorkspace() ?? createInitialWorkspace());
    try { const preferences = JSON.parse(localStorage.getItem("got-it.model-preferences.v1") || "null"); if (preferences) loaded = restoreWorkspace({ ...loaded, ...preferences }) ?? loaded; } catch { /* retain defaults */ }
    return { ...loaded, modelDefaultsVersion: 3, modelPreferences: loaded.modelDefaultsVersion === 3 ? loaded.modelPreferences : { ...loaded.modelPreferences, explain: modelConfig("explain"), entity: modelConfig("entity") }, activeProviderId: "codex" };
  });
  const workspaceRef = useRef(workspace);
  workspaceRef.current = workspace;
  const [documentLoadId, setDocumentLoadId] = useState(0);
  const [codexModels, setCodexModels] = useState<CodexModel[]>([]);
  const [modelsLoading, setModelsLoading] = useState(true);
  const [modelsError, setModelsError] = useState("");
  const [providers, setProviders] = useState<ProviderStatus[]>(FALLBACK_PROVIDERS);
  const [selectionDraft, setSelectionDraft] = useState<SelectionDraft | null>(null);
  const [focusedInquiryId, setFocusedInquiryId] = useState<string | null>(null);
  const [providerOpen, setProviderOpen] = useState(false);
  const [settingsIntent, setSettingsIntent] = useState<InquiryIntent>("explain");
  const providerControlRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!providerOpen) return;
    const outside = (event: PointerEvent) => { if (!providerControlRef.current?.contains(event.target as Node)) setProviderOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { setProviderOpen(false); providerControlRef.current?.querySelector<HTMLButtonElement>(".provider-trigger")?.focus(); } };
    document.addEventListener("pointerdown", outside); document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape); };
  }, [providerOpen]);
  const [searchQuery, setSearchQuery] = useState("");
  const [toast, setToast] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [mobilePanelOpen, setMobilePanelOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const articleRef = useRef<HTMLElement>(null);
  const requests = useRef(new Map<string, { id: string; controller: AbortController }>());
  const [progress, setProgress] = useState<Record<string, string>>({});
  useEffect(() => () => { for (const request of requests.current.values()) request.controller.abort(); }, []);
  const toastTimerRef = useRef<number | null>(null);

  const installLibraryWorkspace = useCallback((next: Workspace) => {
    workspaceRef.current = next; setWorkspace(next); setDocumentLoadId(v => v + 1);
    setProgress({}); setSearchQuery(""); setSelectionDraft(null); setFocusedInquiryId(null); setMobileSidebarOpen(false); setMobilePanelOpen(false); setProviderOpen(false);
    window.getSelection()?.removeAllRanges();
  }, []);
  const interruptForSwitch = useCallback(() => {
    for (const request of requests.current.values()) request.controller.abort();
    requests.current.clear(); setProgress({});
    const next = restoreWorkspace(workspaceRef.current) ?? workspaceRef.current;
    workspaceRef.current = next; setWorkspace(next); return next;
  }, []);
  const library = useReadingLibrary({ workspace, install: installLibraryWorkspace, interrupt: interruptForSwitch });

  const rendered = useMemo(
    () => renderMarkdown(workspace.document.markdown),
    [workspace.document.markdown],
  );

  const selectedInquiry = useMemo(
    () =>
      workspace.inquiries.find((item) => item.id === workspace.activeInquiryId) ??
      null,
    [workspace.activeInquiryId, workspace.inquiries],
  );

  const representative = workspace.inquiries.find(i => i.id === workspace.activeTab?.anchorInquiryId) ?? selectedInquiry;
  const tabIntent = workspace.activeTab?.intent ?? selectedInquiry?.intent ?? "explain";
  const group = representative ? anchorGroup(workspace.inquiries, representative) : [];
  const history = intentHistory(group, tabIntent);
  const activeInquiry = selectedInquiry?.intent === tabIntent ? selectedInquiry : null;
  const categoryItems = intentHistory(workspace.inquiries, tabIntent);
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
    setModelsLoading(true); setModelsError("");
    try {
      setCodexModels(await loadModelCatalog(refresh));
    } catch (error) { setCodexModels([]); setModelsError(readError(error)); }
    finally { setModelsLoading(false); }
  }, []);
  useEffect(() => { void refreshModels(); }, [refreshModels]);

  useEffect(() => {
    if (modelsLoading || modelsError || !codexModels.length) return;
    const intents = ["explain", "verify", "entity", "why"] as const;
    const repaired = intents.filter(intent => !supportsConfig(codexModels, modelConfig(intent, workspace.modelPreferences)));
    if (!repaired.length) return;
    setWorkspace(current => ({ ...current, modelPreferences: Object.fromEntries(intents.map(intent => [intent, resolveModelConfig(intent, current.modelPreferences, codexModels)])), updatedAt: now(), hasUnexportedChanges: true }));
    showToast("已更新为可用的模型配置，可直接开始；也可以自行调整。");
  }, [codexModels, modelsLoading, modelsError, workspace.modelPreferences, showToast]);

  const refreshProviders = useCallback(async () => {
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
    if (!workspace.document.isDemo) return;
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
    if (library.entry) {
      const frame = window.requestAnimationFrame(() => library.rendered());
      return () => window.cancelAnimationFrame(frame);
    }
    const id = workspace.activeInquiryId;
    if (!id) return;
    const frame = window.requestAnimationFrame(() => {
      const target = [...(articleRef.current?.querySelectorAll<HTMLElement>("mark[data-inquiry-id]") ?? [])].find(mark => mark.dataset.inquiryId === id);
      target?.scrollIntoView({ block: "center", behavior: "instant" });
    });
    return () => window.cancelAnimationFrame(frame);
    // Intentionally only restore on document load; request updates must not move reading position.
  }, [workspace.document.id, documentLoadId]);

  const updateWorkspace = useCallback(
    (recipe: (current: Workspace) => Workspace) => {
      setWorkspace((current) => ({
        ...recipe(current),
        updatedAt: now(),
        hasUnexportedChanges: true,
      }));
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
    [updateWorkspace, library.readOnly, library.busy, library.ready],
  );

  const askProvider = useCallback(
    async (inquiryId: string, request: InquiryRequest) => {
      if (library.readOnly || library.busy || !library.ready || requests.current.has(inquiryId)) return;
      const requestId = newId("request"), messageId = newId("message"), controller = new AbortController();
      const operation = request.operation ?? (request.intent === "why" ? "explain" : request.intent);
      const scoped = { ...request, modelConfig: request.providerId === "codex" ? request.modelConfig ?? resolveModelConfig(operation, workspace.modelPreferences, codexModels) : undefined, requestId, operation, scope: request.scope ?? "initial" as const, round: request.round ?? 1 };
      requests.current.set(inquiryId, { id: requestId, controller });
      updateInquiry(inquiryId, inquiry => ({ ...inquiry, messages: [...inquiry.messages, { id: messageId, role: "assistant", content: "", createdAt: now(), modelConfig: scoped.modelConfig, requestId, completion: "provisional", operation: scoped.operation, scope: scoped.scope, round: scoped.round, parentMessageId: scoped.parentMessageId }] }));
      try {
        await readInquiryStream(scoped, event => {
          if (requests.current.get(inquiryId)?.id !== requestId) return;
          if (event.type === "answer-delta" && event.delta?.trim()) setProgress(current => ({ ...current, [inquiryId]: "正在生成正文" }));
          if (event.progress) setProgress(current => ({ ...current, [inquiryId]: PROGRESS_LABELS[event.progress!] }));
          updateInquiry(inquiryId, inquiry => ({ ...inquiry,
            messages: inquiry.messages.map(message => message.id !== messageId ? message : event.response
              ? { ...responseMessage(messageId, scoped, event.response, event.type === "complete"), timings: event.timings }
              : event.type === "answer-delta" ? { ...message, content: message.content + event.delta, timings: event.timings }
              : event.source ? { ...message, sources: message.sources?.map(source => source.id === event.source!.id ? event.source! : source) } : message),
            status: event.type === "complete" ? scoped.operation === "verify" && event.response?.evidenceStatus !== "supported" ? "needs-verification" : "ready" : "answering",
            lastError: undefined, updatedAt: now(),
          }));
        }, controller.signal);
      } catch (error) {
        if (requests.current.get(inquiryId)?.id === requestId) updateInquiry(inquiryId, inquiry => ({ ...inquiry,
          messages: inquiry.messages.map(message => message.id === messageId ? interruptMessage(message) : message),
          status: "ready", updatedAt: now(), lastError: readError(error),
        }));
      } finally {
        if (requests.current.get(inquiryId)?.id === requestId) {
          requests.current.delete(inquiryId);
          setProgress(current => { const next = { ...current }; delete next[inquiryId]; return next; });
        }
      }
    },
    [updateInquiry, workspace.modelPreferences, codexModels, library.readOnly, library.busy, library.ready],
  );

  const handleArticleMouseUp = useCallback(() => {
    if (library.readOnly || library.busy || !library.ready) return;
    window.requestAnimationFrame(() => {
      const article = articleRef.current;
      const selection = window.getSelection();
      if (!article || !selection || selection.isCollapsed) {
        setSelectionDraft(null);
        return;
      }
      const result = createAnchorFromSelection(
        selection,
        article,
        workspace.document.id,
      );
      if ("error" in result) {
        setSelectionDraft(null);
        showToast(result.error);
        return;
      }
      setSelectionDraft(result);
    });
  }, [showToast, workspace.document.id, library.readOnly, library.busy, library.ready]);

  const createInquiry = useCallback(
    (intent: InquiryIntent) => {
      if (library.readOnly || library.busy || !library.ready) return;
      const draft = selectionDraft;
      if (!draft) return;
      if (workspace.activeProviderId === "codex" && (modelsLoading || modelsError || !codexModels.length)) { showToast("请先等待模型列表加载完成，或刷新连接后再试。"); return; }
      const matches = workspace.inquiries.filter(i => sameAnchor(i.anchor, draft.anchor));
      const existing = intentHistory(matches, intent)[0];
      if (existing) {
        updateWorkspace(current => ({ ...current, activeInquiryId: existing.id, activeTab: { anchorInquiryId: existing.id, intent } }));
        setSelectionDraft(null); setMobilePanelOpen(true); window.getSelection()?.removeAllRanges(); return;
      }
      if (matches.some(i => i.status === "answering")) return;
      const createdAt = now();
      const id = newId("inquiry");
      const question = INTENT_META[intent].prompt(draft.anchor.quote);
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
        intent,
        quote: draft.anchor.quote,
        context: readingContext(articleRef.current, draft.anchor),
        documentTitle: workspace.document.filename,
        question,
        history: [],
      };
      setSelectionDraft(null);
      setMobilePanelOpen(true);
      window.getSelection()?.removeAllRanges();
      void askProvider(id, request);
    },
    [askProvider, workspace.inquiries, selectionDraft, updateWorkspace, workspace.activeProviderId, workspace.document.filename, modelsLoading, modelsError, codexModels, showToast],
  );

  const submitFollowUp = useCallback(
    (action: Refinement) => {
      if (!activeInquiry || groupBusy || !canCompleteInquiry(activeInquiry)) return;
      if (activeInquiry.intent === "verify" || (action === "detail") !== (activeInquiry.intent === "entity")) return;
      const content = REFINEMENTS[action].prompt;
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
        quote: activeInquiry.anchor.quote,
        context: readingContext(articleRef.current, activeInquiry.anchor),
        documentTitle: workspace.document.filename,
        question: content,
        history,
      });
    }, [activeInquiry, groupBusy, askProvider, updateInquiry, workspace.activeProviderId, workspace.document.filename],
  );

  const retryInquiry = useCallback(() => {
    if (!activeInquiry || groupBusy || requests.current.has(activeInquiry.id)) return;
    const failed = activeInquiry.messages.at(-1);
    const parentMessageId = failed?.parentMessageId ?? failed?.verification?.parentMessageId;
    const parent = activeInquiry.messages.find(m => m.id === parentMessageId);
    const lastUserMessage = [...activeInquiry.messages]
      .reverse()
      .find((message) => message.role === "user");
    updateInquiry(activeInquiry.id, (inquiry) => ({
      ...inquiry,
      status: "answering",
      lastError: undefined,
    }));
    void askProvider(activeInquiry.id, {
      providerId: workspace.activeProviderId,
      intent: activeInquiry.intent,
      quote: activeInquiry.anchor.quote,
      context: readingContext(articleRef.current, activeInquiry.anchor),
      documentTitle: workspace.document.filename,
      modelConfig: failed?.modelConfig,
      operation: failed?.operation ?? (activeInquiry.intent === "why" ? "explain" : activeInquiry.intent),
      scope: failed?.scope ?? failed?.verification?.scope ?? "initial", round: failed?.round ?? failed?.verification?.round ?? 1, parentMessageId,
      previous: parent?.verification ? { verification: parent.verification, sources: parent.sources ?? [] } : undefined,
      question: lastUserMessage?.content ?? activeInquiry.question,
      history: activeInquiry.messages.slice(0, lastUserMessage ? activeInquiry.messages.lastIndexOf(lastUserMessage) : 0).filter(m => m.content.trim()).slice(-12).map(({ role, content }) => ({ role, content })),
    });
  }, [activeInquiry, groupBusy, askProvider, updateInquiry, workspace.activeProviderId, workspace.document.filename]);

  const continueVerification = useCallback(() => {
    if (!activeInquiry || activeInquiry.intent !== "verify" || groupBusy || !canCompleteInquiry(activeInquiry) || !activeProvider.supportsWebSearch || requests.current.has(activeInquiry.id)) return;
    const previous = [...activeInquiry.messages].reverse().find(m => m.verification?.completion === "complete");
    if (previous?.verification?.verdict === "incomplete") return;
    const round = (previous?.verification?.round ?? 1) + 1;
    const question = "继续查找来源：针对前轮缺口寻找其他原始出处或研究，标明范围差异和本轮变化。";
    updateInquiry(activeInquiry.id, inquiry => ({ ...inquiry, status: "answering", lastError: undefined, messages: [...inquiry.messages, { id: newId("message"), role: "user", content: question, createdAt: now() }] }));
    void askProvider(activeInquiry.id, { providerId: workspace.activeProviderId, intent: "verify", operation: "verify", scope: "expanded", round, parentMessageId: previous?.id,
      previous: previous?.verification ? { verification: previous.verification, sources: previous.sources ?? [] } : undefined,
      quote: activeInquiry.anchor.quote, context: readingContext(articleRef.current, activeInquiry.anchor),
      documentTitle: workspace.document.filename, question, history: activeInquiry.messages.filter(m => m.content).slice(-12).map(({ role, content }) => ({ role, content })) });
  }, [activeInquiry, groupBusy, activeProvider.supportsWebSearch, askProvider, updateInquiry, workspace.activeProviderId, workspace.document.filename]);

  const cancelInquiry = () => {
    if (!activeInquiry) return;
    const pending = requests.current.get(activeInquiry.id);
    if (!pending) return;
    requests.current.delete(activeInquiry.id);
    pending.controller.abort();
    setProgress(current => { const next = { ...current }; delete next[activeInquiry.id]; return next; });
    updateInquiry(activeInquiry.id, inquiry => ({ ...inquiry, status: "ready", lastError: "已停止本次请求；已收到的内容已保留，可手动重试。", messages: inquiry.messages.map(interruptMessage), updatedAt: now() }));
  };

  const switchTab = (intent: InquiryIntent) => {
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

  const jumpToInquiry = useCallback(
    (inquiryId: string) => {
      const documentId = workspaceRef.current.document.id;
      setFocusedInquiryId(null);
      updateWorkspace((current) => ({ ...current, activeInquiryId: inquiryId, activeTab: undefined }));
      setMobilePanelOpen(true);
      setMobileSidebarOpen(false);
      window.requestAnimationFrame(() => {
        const article = articleRef.current;
        // A late animation frame must not scroll a newly opened document/thread.
        if (!article || workspaceRef.current.document.id !== documentId || workspaceRef.current.activeInquiryId !== inquiryId) return;
        const target = findInquiryHighlight(article, workspaceRef.current.inquiries, inquiryId);
        target?.scrollIntoView({ behavior: "smooth", block: "center" });
      });
    },
    [updateWorkspace],
  );

  const handleArticleClick = useCallback(
    (event: MouseEvent<HTMLElement>) => {
      const target = event.target as HTMLElement;
      const mark = target.closest<HTMLElement>("mark[data-inquiry-id]");
      if (mark?.dataset.inquiryId) jumpToInquiry(mark.dataset.inquiryId);
    },
    [jumpToInquiry],
  );

  const setInquiryStatus = useCallback(
    (status: "understood") => {
      if (!activeInquiry) return;
      if (activeInquiry.intent === "verify" ? activeInquiry.status === "answering" : !canCompleteInquiry(activeInquiry)) {
        showToast("等回答完成后，再标记理解。");
        return;
      }
      updateInquiry(activeInquiry.id, (inquiry) => ({
        ...inquiry,
        status,
        updatedAt: now(),
        completedAt: now(),
      }));
      showToast(activeInquiry.intent === "verify" ? "已查找" : STATUS_META[status].label);
    },
    [activeInquiry, showToast, updateInquiry],
  );

  const normalizedSearch = searchQuery.trim().toLocaleLowerCase();
  const filteredOutline = rendered.outline.filter((item) =>
    item.text.toLocaleLowerCase().includes(normalizedSearch),
  );

  return (
    <div
      className={`app-frame ${mobileSidebarOpen ? "sidebar-open" : ""} ${mobilePanelOpen ? "panel-open" : ""}`}
      onDragEnter={(event) => {
        event.preventDefault();
        setIsDragging(true);
      }}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={(event) => {
        if (event.currentTarget === event.target) setIsDragging(false);
      }}
      onDrop={handleDrop}
    >
      <input
        ref={fileInputRef}
        type="file"
        accept=".md,.focus,.json,text/markdown,application/json"
        aria-label="打开 Markdown 或阅读文档"
        hidden
        onChange={handleFileChange}
      />

      <aside className="left-sidebar" aria-label="文档导航">
        <div className="brand-row">
          <BrandMark />
          <div>
            <strong>Got-it</strong>
            <span>knowledge-gap reader</span>
          </div>
          <button
            className="icon-button sidebar-close"
            type="button"
            aria-label="关闭导航"
            onClick={() => setMobileSidebarOpen(false)}
          >
            <X size={16} />
          </button>
        </div>

        <ReadingLibraryNavigation library={library} importCopy={() => fileInputRef.current?.click()} />

        <div className="sidebar-search">
          <Search size={14} />
          <input
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="搜索目录"
            aria-label="搜索目录"
          />
          {searchQuery ? (
            <button type="button" aria-label="清空搜索" onClick={() => setSearchQuery("")}>
              <X size={13} />
            </button>
          ) : null}
        </div>

        <nav className="sidebar-scroll">
          <section className="nav-section">
            <div className="section-label">
              <span>文档结构</span>
              <span>{rendered.outline.length}</span>
            </div>
            {!filteredOutline.length ? <p className="nav-empty" role="status">{rendered.outline.length ? "没有匹配的目录标题。" : "本文暂无标题目录。"}</p> : null}
            <div className="outline-list">
              {filteredOutline.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={`outline-item level-${item.level}`}
                  onClick={() => {
                    document.getElementById(item.id)?.scrollIntoView({ behavior: "smooth" });
                    setMobileSidebarOpen(false);
                  }}
                >
                  {item.text}
                </button>
              ))}
            </div>
          </section>

        </nav>
      </aside>

      <main className="reader-column">
        <header className="reader-toolbar">
          <div className="toolbar-title">
            <button
              className="icon-button mobile-only"
              type="button"
              aria-label="打开导航"
              onClick={() => setMobileSidebarOpen(true)}
            >
              <Menu size={18} />
            </button>
            <FileText size={15} />
            <div>
              <strong>{workspace.document.filename}</strong>
              <span>{workspace.document.isDemo ? "示例文档" : "本地文档"} · {Math.max(1, Math.round(workspace.document.markdown.length / 1000))}k 字符</span>
            </div>
          </div>

          <div className="toolbar-actions">
            <div className="provider-control" ref={providerControlRef}>
              <button
                className="provider-trigger"
                title="AI 连接与模型设置"
                aria-label="AI 连接与模型设置"
                type="button"
                aria-expanded={providerOpen}
                onClick={() => setProviderOpen((value) => !value)}
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
          <CodexLogin provider={activeProvider} onConnected={onCodexConnected} />
          <details className="model-settings" open onToggle={event => { if (event.currentTarget.open) void refreshModels(); }}>
          <summary>模型设置</summary><div className="model-controls">
            <label className="settings-purpose">用途<select aria-label="设置用途" value={settingsIntent} onChange={e => setSettingsIntent(e.target.value as InquiryIntent)}>{NEW_INQUIRY_INTENTS.map(intent => <option key={intent} value={intent}>{INTENT_META[intent].label}</option>)}</select></label>
            {workspace.activeProviderId === "codex" ? <>
              <label>模型<select aria-label="当前用途的模型" disabled={modelsLoading || !!modelsError} value={selectedModelInfo ? currentModel.model : ""} onChange={e => {
                const model = codexModels.find(m => m.model === e.target.value);
                if (model) changeModel({ model: model.model, reasoningEffort: model.supportedReasoningEfforts.some(e => e.reasoningEffort === currentModel.reasoningEffort) ? currentModel.reasoningEffort : model.defaultReasoningEffort });
              }}>
                {!selectedModelInfo ? <option value="" disabled>{modelsLoading ? "正在加载模型…" : "模型列表读取失败"}</option> : null}
                {codexModels.map(model => <option key={model.model} value={model.model}>{model.displayName}</option>)}
              </select></label>
              <label>推理强度<select aria-label="当前用途的推理强度" disabled={modelsLoading || !!modelsError || !selectedModelInfo} value={selectedModelInfo ? currentModel.reasoningEffort : ""} onChange={e => changeModel({ ...currentModel, reasoningEffort: e.target.value })}>
                {!selectedModelInfo?.supportedReasoningEfforts.some(e => e.reasoningEffort === currentModel.reasoningEffort) ? <option value="" disabled>—</option> : null}
                {selectedModelInfo?.supportedReasoningEfforts.map(effort => <option key={effort.reasoningEffort} value={effort.reasoningEffort} title={effort.description}>{effort.reasoningEffort}</option>)}
              </select></label>
              {modelsLoading ? <small>正在读取模型列表…</small> : null}
              {modelsError ? <small role="alert">{modelsError}。<button type="button" onClick={() => void refreshModels(true)}>重试读取模型</button></small> : null}
            </> : <small>当前使用 {activeProvider.name}，模型由该连接配置。</small>}
          </div>
          </details>
                </ProviderPopover>
              </div>
            </div>
            <button
              className="icon-button mobile-only"
              type="button"
              aria-label="打开知识贴"
              onClick={() => setMobilePanelOpen(true)}
            >
              <PanelRightOpen size={18} />
            </button>
          </div>
        </header>

        <div className="library-save-status" role="status">{library.status}{library.busy ? " · 正在处理…" : ""}</div>
        <ReadingLibraryStatus library={library} />
        <div className="reader-scroll" onScroll={library.scrolled}>
          {workspace.document.isDemo ? (
            <div className="demo-document-note">
              <Sparkles size={15} />
              <span><strong>可直接体验：</strong>选中 “CAGR” 或 “67% 的 35 岁以下成人”，再选择一种追问方式。</span>
              <button type="button" onClick={() => void library.choose()}>换成我的文档</button>
            </div>
          ) : null}
          <article
            ref={articleRef}
            className="markdown-article"
            onMouseUp={handleArticleMouseUp}
            onClick={handleArticleClick}
            dangerouslySetInnerHTML={{ __html: rendered.html }}
          />
          <footer className="reader-footer">
            <BookOpenText size={15} />
            <span>读到不懂处，选中原文。一次只解决一个知识缺口。</span>
          </footer>
        </div>
      </main>

      <aside className="right-panel" aria-label="活动知识贴">
        <div className="panel-mobile-head">
          <span>活动知识贴</span>
          <button className="icon-button" type="button" onClick={() => setMobilePanelOpen(false)}>
            <X size={17} />
          </button>
        </div>
        <>
          <div className="inquiry-tabs" role="tablist" aria-label="本文知识贴分类">
            {NEW_INQUIRY_INTENTS.map((intent, index) => {
              const items = intentHistory(workspace.inquiries, intent);
              const Icon = INTENT_ICONS[intent];
              const busy = items.some(i => i.status === "answering");
              return <button key={intent} id={`intent-tab-${intent}`} data-intent={intent} type="button" role="tab" aria-selected={tabIntent === intent} aria-busy={busy} aria-controls="intent-result" tabIndex={tabIntent === intent || (tabIntent === "why" && index === 0) ? 0 : -1}
                onClick={() => switchTab(intent)} onKeyDown={event => {
                  const next = event.key === "ArrowRight" ? (index + 1) % 3 : event.key === "ArrowLeft" ? (index + 2) % 3 : event.key === "Home" ? 0 : event.key === "End" ? 2 : -1;
                  if (next < 0) return; event.preventDefault(); switchTab(NEW_INQUIRY_INTENTS[next]); document.getElementById(`intent-tab-${NEW_INQUIRY_INTENTS[next]}`)?.focus();
                }}><Icon size={14} aria-hidden="true" /><span>{INTENT_META[intent].label}{items.length > 0 ? <span className="tab-count">({items.length > 99 ? "99+" : items.length})</span> : null}</span>{busy ? <i className="tab-busy" aria-label="处理中" /> : null}</button>;
            })}
          </div>
          {activeInquiry && history.length > 1 ? <label className="history-picker">历史记录<select aria-label="历史记录" value={activeInquiry?.id} onChange={e => updateWorkspace(current => ({ ...current, activeInquiryId: e.target.value }))}>{history.map(i => <option key={i.id} value={i.id}>{new Date(i.updatedAt).toLocaleString()} · {i.question}</option>)}</select></label> : null}
        </>
        <div className={`intent-result${activeInquiry ? "" : " category-view"}`} id="intent-result" role="tabpanel" aria-labelledby={tabIntent !== "why" ? `intent-tab-${tabIntent}` : undefined}>
        {activeInquiry ? <div className="result-navigation"><button type="button" onClick={() => switchTab(tabIntent)}>‹ 全部{INTENT_META[tabIntent].label}</button><strong title={activeInquiry.anchor.quote}>{activeInquiry.anchor.quote}</strong></div> : null}
        <nav hidden={!!activeInquiry} className="category-items" aria-label={`${INTENT_META[tabIntent].label}条目`}>
          <div className="category-heading"><strong>本文的{INTENT_META[tabIntent].label}</strong><span>{categoryItems.length} 条</span></div>
          {categoryItems.length ? categoryItems.map(item => <button type="button" key={item.id} data-inquiry-id={item.id} aria-current={activeInquiry?.id === item.id ? "true" : undefined} onFocus={() => setFocusedInquiryId(item.id)} onBlur={() => setFocusedInquiryId(null)} onClick={() => jumpToInquiry(item.id)}>
            <span>{item.anchor.quote}</span><small>{inquiryCategoryStatus(item)}</small>
          </button>) : <p>还没有{INTENT_META[tabIntent].label}条目。在原文选中文字，再选择“{INTENT_META[tabIntent].label}”即可创建。</p>}
        </nav>
        {activeInquiry && new Set(group.map(i => i.intent)).size > 1 ? <nav className="anchor-requests" aria-label="这处原文的已有需求"><small>此处已有</small>{([...NEW_INQUIRY_INTENTS, "why"] as InquiryIntent[]).filter(intent => group.some(i => i.intent === intent)).map(intent => <button type="button" key={intent} aria-current={intent === activeInquiry.intent ? "true" : undefined} onClick={() => { if (intent !== activeInquiry.intent) jumpToInquiry(intentHistory(group, intent)[0].id); }}>{INTENT_META[intent].shortLabel}</button>)}</nav> : null}
        {activeInquiry ? (
          <InquiryPanel
            key={activeInquiry.id}
            inquiry={activeInquiry}
            groupBusy={groupBusy || library.readOnly || library.busy}
            modelReady={modelReady && !library.readOnly && !library.busy}
            onCancel={cancelInquiry}
            provider={activeProvider}
            onFollowUp={submitFollowUp}
            onRetry={retryInquiry}
            onContinue={continueVerification}
            progress={progress[activeInquiry.id]}
            onSetStatus={setInquiryStatus}
            onReturnToReading={() => { switchTab(tabIntent); setMobilePanelOpen(false); }}
          />
        ) : (
          categoryItems.length ? <div className="empty-intent"><p>选择上方条目查看结果。</p></div> : null
        )}
        </div>
      </aside>

      {selectionDraft ? (
        <SelectionToolbar
          draft={selectionDraft}
          onSelect={createInquiry}
          onClose={() => {
            setSelectionDraft(null);
            window.getSelection()?.removeAllRanges();
          }}
        />
      ) : null}

      {isDragging ? (
        <div className="drop-overlay">
          <div>
            <Upload size={24} />
            <strong>放下 Markdown 或阅读文档</strong>
            <span>当前文档不会被修改</span>
          </div>
        </div>
      ) : null}

      {mobileSidebarOpen || mobilePanelOpen ? (
        <button
          className="mobile-scrim"
          type="button"
          aria-label="关闭面板"
          onClick={() => {
            setMobileSidebarOpen(false);
            setMobilePanelOpen(false);
          }}
        />
      ) : null}

      {toast ? <div className="toast" role="status">{toast}</div> : null}
    </div>
  );
}

function BrandMark() {
  return (
    <span className="brand-mark" aria-hidden="true">
      {Array.from({ length: 9 }, (_, index) => <i key={index} />)}
    </span>
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
          <span>只影响之后的回答</span>
        </div>
        <button className="icon-button" type="button" onClick={onClose}><X size={14} /></button>
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
}: {
  draft: SelectionDraft;
  onSelect: (intent: InquiryIntent) => void;
  onClose: () => void;
}) {
  const left = Math.min(
    Math.max(draft.rect.left + draft.rect.width / 2, 238),
    window.innerWidth - 238,
  );
  const top = Math.min(draft.rect.top + draft.rect.height + 12, window.innerHeight - 82);
  return (
    <div
      className="selection-toolbar"
      style={{ left, top }}
      onMouseDown={(event) => event.preventDefault()}
    >
      <div className="selection-quote">“{draft.anchor.quote}”</div>
      <div className="selection-actions">
        {NEW_INQUIRY_INTENTS.map((intent) => {
          const Icon = INTENT_ICONS[intent];
          return (
            <button key={intent} type="button" data-intent={intent} onClick={() => onSelect(intent)}>
              <Icon size={14} />
              {INTENT_META[intent].label}
            </button>
          );
        })}
        <button className="selection-close" type="button" aria-label="关闭" onClick={onClose}>
          <X size={14} />
        </button>
      </div>
    </div>
  );
}

interface InquiryPanelProps {
  onCancel: () => void;
  modelReady: boolean;
  groupBusy: boolean;
  inquiry: Inquiry;
  provider: ProviderStatus;
  onFollowUp: (action: Refinement) => void;
  onRetry: () => void;
  onContinue: () => void;
  progress?: string;
  onSetStatus: (status: "understood") => void;
  onReturnToReading: () => void;
}

function InquiryPanel({
  onCancel,
  modelReady,
  groupBusy,
  inquiry,
  provider,
  onFollowUp,
  onRetry,
  onContinue,
  progress,
  onSetStatus,
  onReturnToReading,
}: InquiryPanelProps) {
  const isComplete = inquiry.status === "understood" || inquiry.status === "distilled";
  const latestAssistant = [...inquiry.messages]
    .reverse()
    .find((message) => message.role === "assistant");

  const actionsEnabled = !groupBusy && canCompleteInquiry(inquiry);
  const verificationUnfinished = isVerificationUnfinished(inquiry);
  const recheckDisabledReason = groupBusy ? "当前请求正在进行，请等待完成或先停止" : !modelReady ? "请先连接可用模型" : !provider.supportsWebSearch ? "当前提供方不支持联网查找来源，请切换支持搜索的提供方" : undefined;
  const threadRef = useRef<HTMLDivElement>(null);
  const lastThreadKey = useRef("");
  useEffect(() => {
    const thread = threadRef.current;
    const key = `${inquiry.id}:${inquiry.messages.length}:${latestAssistant?.completion}`;
    if (!thread || lastThreadKey.current === key) return;
    if (!lastThreadKey.current) thread.scrollTop = 0;
    else {
      const last = thread.querySelector<HTMLElement>(".assistant-message:last-of-type");
      if (last) thread.scrollTop += last.getBoundingClientRect().top - thread.getBoundingClientRect().top;
    }
    lastThreadKey.current = key;
  }, [inquiry.id, inquiry.messages.length, latestAssistant?.completion]);

  return (
    <div className="inquiry-panel-content">
      <div className="thread-scroll" ref={threadRef}>
        {inquiry.anchor.matchStatus === "needs-relink" ? <p className="anchor-warning">原文位置需要重新确认</p> : null}
        <div className="thread-messages">
          {inquiry.messages.filter(message => message.role === "assistant" && message.id !== latestAssistant?.id).length ? <details className="answer-history"><summary>历史回答</summary>{inquiry.messages.filter(message => message.role === "assistant" && message.id !== latestAssistant?.id).map(message => <AssistantMessage key={message.id} message={message} history verification={inquiry.intent === "verify"} entity={inquiry.intent === "entity"} />)}</details> : null}
          {latestAssistant ? <AssistantMessage message={latestAssistant} failure={inquiry.lastError} verification={inquiry.intent === "verify"} entity={inquiry.intent === "entity"} /> : null}
          {inquiry.status === "answering" && latestAssistant ? <RequestStatus key={latestAssistant.requestId ?? latestAssistant.id} startedAt={latestAssistant.createdAt} hasText={!!latestAssistant.content.trim()} progress={progress} /> : null}
          {latestAssistant?.mode === "demo" && inquiry.status !== "answering" ? (
            <button className="secondary-action" type="button" onClick={onRetry}><RefreshCw size={13} /> 用真实模型回答</button>
          ) : null}
          {inquiry.lastError && !(latestAssistant && (latestAssistant.operation ? latestAssistant.operation === "verify" : inquiry.intent === "verify")) ? (
            <div className="error-card">
              <CircleAlert size={16} />
              <div><strong>本轮未完成</strong><p>{inquiry.lastError}</p></div>
            </div>
          ) : null}
        </div>

      <footer className="inquiry-actions compact-actions">
        {inquiry.intent === "verify" ? (
          <button className="secondary-action verify-again-action" type="button" disabled={!!recheckDisabledReason} title={recheckDisabledReason} aria-describedby={recheckDisabledReason ? "recheck-unavailable" : undefined} onClick={verificationUnfinished ? onRetry : onContinue}>再找一下</button>
        ) : (
          <button type="button" className={`secondary-action ${inquiry.intent === "entity" ? "detail-introduction-action" : "explain-again-action"}`} disabled={!actionsEnabled || !modelReady} onClick={() => onFollowUp(inquiry.intent === "entity" ? "detail" : "simplify")}>
            {inquiry.intent === "entity" ? "详细介绍" : "再解释下"}
          </button>
        )}
        {inquiry.intent !== "verify" && inquiry.status !== "answering" && (inquiry.lastError || latestAssistant?.completion === "interrupted" || latestAssistant?.verification?.completion === "interrupted" || latestAssistant?.search?.status === "failed") ? (
          <button className="secondary-action regenerate-action" type="button" disabled={groupBusy} onClick={onRetry}><RefreshCw size={14} aria-hidden="true" />重新生成</button>
        ) : null}
        {inquiry.status === "answering" ? <button className="secondary-action stop-action" type="button" onClick={onCancel}>停止本次请求</button> : <button type="button" className="primary-action" disabled={groupBusy || isComplete || (inquiry.intent !== "verify" && !actionsEnabled)} onClick={() => { onSetStatus("understood"); if (inquiry.intent === "verify") onReturnToReading(); }}><CircleCheck size={14} />{isComplete ? inquiry.intent === "verify" ? "已查找" : "已理解" : verificationUnfinished ? "暂时先这样" : "明白了，继续阅读"}</button>}
      </footer>
      {inquiry.intent === "verify" && recheckDisabledReason ? <p className="recheck-unavailable" id="recheck-unavailable">{recheckDisabledReason}</p> : null}
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: Inquiry["status"] }) {
  const meta = STATUS_META[status];
  return <span className={`status-badge tone-${meta.tone}`}>{meta.label}</span>;
}

export function AssistantMessage({ message, verification = false, entity = false, failure, history = false }: { message: ThreadMessage; verification?: boolean; entity?: boolean; failure?: string; history?: boolean }) {
  const isReview = message.operation ? message.operation === "verify" : verification;
  const isIntroduction = message.operation ? message.operation === "entity" : entity;
  const websites = (message.sources ?? []).filter(source => safeSourceUrl(source.url)).filter((source, index, all) => all.findIndex(other => other.url === source.url) === index).sort((a, b) => Number(b.websiteRole === "official") - Number(a.websiteRole === "official"));
  const renderedAnswer = useMemo(() => renderMarkdown(message.content), [message.content]);
  return (
    <article className="assistant-message" data-message-id={message.id} data-completion={message.completion}>
      {isReview ? <VerificationAnswer message={message} failure={failure} history={history} /> : <>
      {message.mode === "demo" ? (
        <div className="demo-answer-label"><Info size={12} /> 演示回答 · 未调用真实模型</div>
      ) : null}
      {message.completion === "provisional" && !message.verification ? <p className="provisional-note" role="status">正在生成，内容尚未完成{message.operation === "verify" || message.operation === "entity" ? "；来源与结论尚未核对" : ""}。</p> : null}
      {message.completion === "interrupted" ? <p className="no-source-note">本轮中断，未收到最终结果。</p> : null}
      <div className="answer-markdown" dangerouslySetInnerHTML={{ __html: renderedAnswer.html }} />
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
    <div className="request-status"><span>{hasText ? "正在生成" : progress ?? "正在处理"}</span><time aria-label="本次请求已用时间">{elapsed.toFixed(1)}s</time></div>
    {!hasText && elapsed >= 8 ? <div className="waiting-toast" role="status">请再稍等一下，我正在{searching ? "查找资料" : "整理答案"}…</div> : null}
  </>;
}

export default App;
