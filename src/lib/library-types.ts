import type { Workspace } from "../types";
export interface ReadingPosition { pdfPage?: number; pdfZoom?: number; pdfLeft?: number; blockId?: string; offset?: number; ratio: number }
export interface LibrarySource { path: string; realPath: string; hash: string }
export interface ReadingRevision { id: string; savedAt: string; workspace: Workspace; position: ReadingPosition }
export interface LibraryEntry {
  contentDigest?: string; recoveryOperationId?: string;
  id: string; version: number; revisionId: string; source: LibrarySource | null;
  workspace: Workspace; position: ReadingPosition; history: ReadingRevision[];
  updatedAt: string; lastOpenedAt: string; creationKey: string;
}
export type LibrarySummary = Pick<LibraryEntry, "id" | "version" | "lastOpenedAt"> & { filename: string; path: string | null; historyCount: number };
export interface LibraryList { entries: LibrarySummary[]; activeId: string | null; warnings: string[]; nativePicker: boolean }
export type SourceStatus = "unlinked" | "available" | "missing" | "permission" | "unreadable" | "changed" | "reselect";
export interface SourceCheck { status: SourceStatus; message: string; candidateId?: string }
export interface SelectedFile { workspace?: Workspace; selectionId: string; filename: string; content: string }
