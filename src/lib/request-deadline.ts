/** One absolute budget; a resumed event must check it before accepting late data. */
export function requestDeadline(budgetMs: number, parent?: AbortSignal) {
  const controller = new AbortController();
  let deadlineAt = Date.now() + budgetMs;
  let monotonicEnd = performance.now() + budgetMs;
  let timer: ReturnType<typeof setTimeout>;
  const timeout = () => controller.abort(Object.assign(new Error("本次请求超时，已收到的内容已保留，请重试。"), { code: "ETIMEDOUT" }));
  const remaining = () => Math.max(0, Math.min(deadlineAt - Date.now(), monotonicEnd - performance.now()));
  const check = () => {
    if (!remaining() && !controller.signal.aborted) timeout();
    controller.signal.throwIfAborted();
  };
  const abort = () => controller.abort(parent?.reason instanceof Error && parent.reason.name !== "AbortError" ? parent.reason : new Error("请求已中断"));
  parent?.addEventListener("abort", abort, { once: true });
  if (parent?.aborted) abort();
  const schedule = () => { clearTimeout(timer); timer = setTimeout(timeout, remaining()); };
  schedule();
  return {
    signal: controller.signal, remaining, check,
    get deadlineAt() { return deadlineAt; },
    reset(at: number) { check(); deadlineAt = at; monotonicEnd = performance.now() + Math.max(0, at - Date.now()); schedule(); check(); },
    async wait<T>(promise: Promise<T>): Promise<T> {
      try { check(); } catch (error) { void promise.catch(() => undefined); throw error; }
      return new Promise<T>((resolve, reject) => {
        const interrupted = () => { cleanup(); reject(controller.signal.reason); };
        const cleanup = () => controller.signal.removeEventListener("abort", interrupted);
        controller.signal.addEventListener("abort", interrupted, { once: true });
        promise.then(value => { cleanup(); try { check(); resolve(value); } catch (error) { reject(error); } }, error => { cleanup(); reject(error); });
        if (controller.signal.aborted) interrupted();
      });
    },
    dispose() { clearTimeout(timer); parent?.removeEventListener("abort", abort); },
  };
}
