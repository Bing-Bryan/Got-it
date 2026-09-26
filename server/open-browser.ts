import { execFile } from "node:child_process";

export function browserCommand(url: string, platform = process.platform): [string, string[]] {
  if (!/^http:\/\/127\.0\.0\.1:\d+\/$/.test(url)) throw new Error("只允许打开本机阅读地址");
  if (platform === "darwin") return ["open", [url]];
  if (platform === "win32") return ["rundll32.exe", ["url.dll,FileProtocolHandler", url]];
  return ["xdg-open", [url]];
}

export async function openBrowser(url: string): Promise<void> {
  const [command, args] = browserCommand(url);
  await new Promise<void>((resolve, reject) => {
    execFile(command, args, { timeout: 10_000, windowsHide: true }, error => error ? reject(error) : resolve());
  });
}

export async function openReadingPage(url: string, options: {
  enabled: boolean;
  hasBuild: boolean;
  browser?: string;
  open?: (url: string) => Promise<void>;
  warn?: (message: string) => void;
}) {
  if (!options.enabled) return;
  const warn = options.warn ?? console.warn;
  if (!options.hasBuild) {
    warn("尚未构建阅读页面，请先运行 npm run build，再运行 npm start。");
    return;
  }
  if (options.browser === "none") return;
  try { await (options.open ?? openBrowser)(url); }
  catch { warn(`未能自动打开浏览器，请手动访问 ${url}`); }
}
