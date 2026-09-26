import { migrateHighlightAnchors } from "./anchor-migration";
import { parseReadingDocument as parseCore, readDocumentFile as readCore } from "./reading-document-core";
export { hasRunningAnswers, MAX_READING_FILE_BYTES, READING_DOCUMENT_FORMAT, readingDocumentFilename, workspaceToReadingDocument } from "./reading-document-core";
export function parseReadingDocument(content: string, allowLegacy = false) { return migrateHighlightAnchors(parseCore(content, allowLegacy)); }
export async function readDocumentFile(file: Pick<File, "name" | "size" | "text">) { return migrateHighlightAnchors(await readCore(file)); }
