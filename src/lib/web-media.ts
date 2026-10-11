import { libraryBinary } from "./library-client";
import type { WebDocumentData } from "./web-data";

/** Set src only after an authenticated local resource read; never inline SVG in the document. */
export function loadWebMedia(root: HTMLElement, web: WebDocumentData, resourcePath: (resourceId: string) => string, onSettled?: () => void) {
  const controller = new AbortController(), urls: string[] = [];
  const media = web.media.filter(item => item.status === "saved");
  let index = 0;
  const work = async () => {
    while (!controller.signal.aborted && index < media.length) {
      const item = media[index++];
      const images = [...root.querySelectorAll<HTMLImageElement>("img[data-web-media]")].filter(img => img.dataset.webMedia === item.id);
      if (!images.length) continue;
      try {
        const response = await libraryBinary(resourcePath(item.resourceId!), undefined, true, controller.signal);
        const blob = await response.blob();
        if (controller.signal.aborted) return;
        if (blob.type.split(";")[0] !== item.mime || blob.size !== item.bytes) throw new Error("资源校验失败");
        const url = URL.createObjectURL(blob); urls.push(url);
        await Promise.all(images.map(image => new Promise<void>(resolve => {
          let settled = false;
          const done = () => { if (settled) return; settled = true; clearTimeout(timer); image.removeEventListener("load", loaded); image.removeEventListener("error", failed); controller.signal.removeEventListener("abort", done); resolve(); };
          const loaded = () => done();
          const failed = () => { if (!controller.signal.aborted) unavailable(image, item.alt); done(); };
          const timer = setTimeout(failed, 10_000);
          image.addEventListener("load", loaded, { once: true });
          image.addEventListener("error", failed, { once: true });
          controller.signal.addEventListener("abort", done, { once: true });
          image.src = url;
          if (image.complete && image.naturalWidth) done();
        })));

      } catch {
        if (!controller.signal.aborted) for (const image of images) unavailable(image, item.alt);
      }
    }
  };
  void Promise.all(Array.from({ length: Math.min(4, media.length) }, work)).finally(() => { if (!controller.signal.aborted) onSettled?.(); });
  return () => { controller.abort(); for (const url of urls) URL.revokeObjectURL(url); };
}
function unavailable(image: HTMLImageElement, alt: string) {
  const notice = document.createElement("span"); notice.className = "image-unavailable";
  notice.textContent = `本机图片或图表不可用：${alt || "未命名图片"}。正文和知识贴仍保留，可重新导入原文。`;
  image.replaceWith(notice);
}
