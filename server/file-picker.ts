import { execFile } from "node:child_process";

export class LibraryError extends Error {
  constructor(message: string, public status = 400, public code = "library_error") { super(message); }
}
export type FilePicker = () => Promise<string | null>;

export function pickerError(error: { stderr?: string; killed?: boolean }): LibraryError | null {
  if (error.stderr?.includes("(-128)")) return null;
  if (error.killed || error.stderr?.includes("(-1712)")) return new LibraryError("文件选择超时，请重试。", 408, "picker_timeout");
  return new LibraryError("无法打开本机文件选择器，请检查系统权限，然后重新点击“添加文件”。", 503, "picker_unavailable");
}

export const pickLocalFile: FilePicker = () => {
  if (process.platform !== "darwin") return Promise.reject(new LibraryError("当前系统暂不支持关联本机路径，请从浏览器选择文件。", 503, "picker_unavailable"));
  return new Promise((resolve, reject) => {
    // Fixed program, never interpolate a browser-supplied path or shell command.
    const script = 'with timeout of 600 seconds\ntell application "System Events"\nactivate\nset chosenFile to choose file with prompt "选择要在 Got-it 中阅读的文件"\nreturn POSIX path of chosenFile\nend tell\nend timeout';
    execFile("/usr/bin/osascript", ["-e", script], { timeout: 600_000, maxBuffer: 32_768 }, (error, stdout, stderr) => {
      if (error) {
        const failure = pickerError({ stderr, killed: error.killed });
        if (failure) reject(failure); else resolve(null);
      } else resolve(stdout.replace(/\r?\n$/, "") || null);
    });
  });
};
