import type { ModelConfig, ModelPreferences } from "./lib/model-routing";
export const SCHEMA_VERSION = 2 as const;
import type { PdfDocumentData, PdfLocation } from "./lib/pdf-data";

export const NEW_INQUIRY_INTENTS = ["explain", "verify", "ask"] as const;

export type ActiveInquiryIntent = typeof NEW_INQUIRY_INTENTS[number] | "entity";
// `why` is a stored legacy identity, not a separate generation operation.
export type InquiryIntent = ActiveInquiryIntent | "why";

export type InquiryStatus =
  | "pending"
  | "answering"
  | "ready"
  | "needs-verification"
  | "understood"
  | "distilled";

export type EvidenceStatus =
  | "supported"
  | "partial"
  | "unsupported"
  | "not-applicable";

export type AnswerMode = "live" | "demo";

export type ProviderId = "codex" | "deepseek" | "demo";

export type ProviderAvailability = "connected" | "available" | "unavailable" | "checking";

export interface ProviderStatus {
  id: ProviderId;
  name: string;
  description: string;
  availability: ProviderAvailability;
  model?: string;
  detail?: string;
  supportsWebSearch: boolean;
  localOnly?: boolean;
}

interface DocumentBase {
  id: string; filename: string; importedAt: string; contentHash: string; isDemo: boolean;
}
export type DocumentSnapshot = (DocumentBase & { kind?: 'markdown'; markdown: string; pdf?: never })
  | (DocumentBase & { kind: 'pdf'; pdf: PdfDocumentData; markdown?: never });

export interface Anchor {
  pdf?: PdfLocation;
  textVersion?: 2;
  documentId: string;
  blockId: string;
  headingPath: string[];
  quote: string;
  prefix: string;
  suffix: string;
  start: number;
  end: number;
  matchStatus: "matched" | "needs-relink";
}

export interface SearchTrace {
  status: "executed" | "failed" | "not-executed" | "unknown";
  completedSearches: number;
  failedSearches: number;
}

export interface Source {
  id: string;
  title: string;
  url: string;
  domain: string;
  snippet?: string;
  excerpt?: string;
  excerptKind?: "quote" | "summary" | "unverified";
  retrievalStatus?: "matched" | "mismatch" | "unavailable" | "unsupported" | "not-read";
  relation?: "supports" | "conflicts" | "related" | "unknown";
  checkedAt?: string;
  locatable?: boolean;
  websiteRole?: "official" | "reference";
  publisher?: string;
  publishedAt?: string;
  origin?: "original" | "secondary" | "unknown";
  reliability?: "strong" | "moderate" | "uncertain";
  reliabilityReasons?: string[];
  scope?: string;
  differences?: string[];
  applicability?: "direct" | "partial" | "background" | "irrelevant" | "unknown";

}

export type Verdict = "supported" | "partial" | "conflicting" | "insufficient" | "incomplete";
export interface Verification {
  verdict: Verdict;
  summary: string;
  reason: string;
  readingAdvice: string;
  claims: Array<{ text: string; verdict: Verdict; sourceIds: string[] }>;
  round: number;
  parentMessageId?: string;
  scope: "initial" | "expanded";
  completion: "provisional" | "complete" | "interrupted";
  changeNote?: string;
}
export interface InquiryOperation {
  explanationMode?: "local" | "web" | "auto";
  modelConfig?: ModelConfig;
  operation?: "explain" | "verify" | "entity" | "ask";
  scope?: "initial" | "expanded";
  round?: number;
  parentMessageId?: string;
  previous?: { verification: Verification; sources: Source[] };
}
export interface InquiryTimings {
  accepted: number;
  firstProgress?: number;
  firstText?: number;
  preliminary?: number;
  complete?: number;
  sourceCheckMs?: number;
}
export interface InquiryEvent {
  deadlineAt?: number;
  requestId: string;
  sequence: number;
  type: "answer-delta" | "progress" | "preliminary" | "source-update" | "complete" | "error";
  delta?: string;
  progress?: "accepted" | "search-started" | "search-completed" | "checking-sources";
  response?: InquiryResponse;
  source?: Source;
  error?: string;
  timings?: InquiryTimings;
}
export interface ThreadMessage extends InquiryOperation {
  requestId?: string;
  completion?: "provisional" | "complete" | "interrupted";
  verification?: Verification;
  timings?: InquiryTimings;
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  sources?: Source[];
  search?: SearchTrace;
  evidenceStatus?: EvidenceStatus;
  mode?: AnswerMode;
  providerId?: ProviderId;
  providerName?: string;
  model?: string;
}

export interface Inquiry {
  contextHistory?: Array<Pick<ThreadMessage, "role" | "content">>;
  id: string;
  intent: InquiryIntent;
  question: string;
  anchor: Anchor;
  status: InquiryStatus;
  messages: ThreadMessage[];
  understanding: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  lastError?: string;
}

export interface Workspace {
  visitedInquiryIds?: string[];
  modelDefaultsVersion?: 2 | 3 | 4;
  activeTab?: { anchorInquiryId?: string; intent: InquiryIntent };
  modelPreferences?: ModelPreferences;
  schemaVersion: 1 | typeof SCHEMA_VERSION;
  document: DocumentSnapshot;
  inquiries: Inquiry[];
  activeInquiryId: string | null;
  activeProviderId: ProviderId;
  updatedAt: string;
  hasUnexportedChanges: boolean;
}

export interface OutlineItem {
  id: string;
  text: string;
  level: number;
}

export interface RenderedMarkdown {
  html: string;
  outline: OutlineItem[];
}

export interface SelectionDraft {
  anchor: Anchor;
  context: string;
  rect: {
    top: number;
    left: number;
    width: number;
    height: number;
  };
}

export interface InquiryRequest extends InquiryOperation {
  image?: { entryId: string; fileHash: string; cropId: string };
  requestId?: string;
  providerId: ProviderId;
  intent: InquiryIntent;
  quote: string;
  context: string;
  documentTitle: string;
  question: string;
  history: Array<Pick<ThreadMessage, "role" | "content">>;
}

export interface InquiryResponse {
  modelConfig?: ModelConfig;
  verification?: Verification;
  timings?: InquiryTimings;
  answer: string;
  sources: Source[];
  search?: SearchTrace;
  evidenceStatus: EvidenceStatus;
  mode: AnswerMode;
  providerId: ProviderId;
  providerName: string;
  model?: string;
}

export interface ProvidersResponse {
  providers: ProviderStatus[];
  defaultProviderId: ProviderId;
}

export const INTENT_META: Record<InquiryIntent, { label: string; shortLabel: string }>
  & Record<ActiveInquiryIntent, { prompt: (quote: string) => string }> = {
  explain: {
    label: "解释一下",
    shortLabel: "解释",
    prompt: (quote) => `请结合原文帮我理解「${quote}」：术语说明含义，人物、公司或产品说明是什么、做什么；句子或图表用通俗语言解释，并说明与上下文的关系。`,
  },
  ask: {
    label: "我的问题",
    shortLabel: "提问",
    prompt: (quote) => `关于「${quote}」的问题`,
  },
  why: {
    label: "为什么",
    shortLabel: "为什么",
  },
  verify: {
    label: "查找来源",
    shortLabel: "来源",
    prompt: (quote) => `请核查「${quote}」的依据，区分报告声称、找到的证据与当前结论。`,
  },
  entity: {
    label: "介绍一下",
    shortLabel: "介绍",
    prompt: (quote) => `请帮我对「${quote}」形成具体印象：它是什么、做什么、与这段文章有什么关系；未知信息请明确说明。`,
  },
};

export const STATUS_META: Record<
  InquiryStatus,
  { label: string; tone: "neutral" | "active" | "warning" | "success" }
> = {
  pending: { label: "待回答", tone: "neutral" },
  answering: { label: "回答中", tone: "active" },
  ready: { label: "待理解", tone: "active" },
  "needs-verification": { label: "待查找", tone: "warning" },
  understood: { label: "已理解", tone: "success" },
  distilled: { label: "已理解", tone: "success" },
};
