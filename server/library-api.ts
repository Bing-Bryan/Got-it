import { randomBytes } from "node:crypto";
import express, { type Request, type Response, type NextFunction } from "express";
import { ReadingLibrary, libraryFailure } from "./reading-library";

export function localOriginGuard(request: Request, response: Response, next: NextFunction) {
  const host = request.headers.host || "";
  if (!/^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(host)) { response.status(403).json({ error: "仅允许本机访问。" }); return; }
  const origin = request.headers.origin;
  const allowed = new Set([`http://${host}`, "http://127.0.0.1:5173", "http://localhost:5173"]);
  const custom = process.env.CORS_ORIGIN;
  if (custom && /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(custom)) allowed.add(custom);
  if ((origin && !allowed.has(origin)) || request.headers["sec-fetch-site"] === "cross-site") { response.status(403).json({ error: "不允许此页面访问本机服务。" }); return; }
  if (origin) { response.setHeader("Access-Control-Allow-Origin", origin); response.setHeader("Vary", "Origin"); }
  response.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Got-It-Session");
  response.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  if (request.method === "OPTIONS") { response.sendStatus(204); return; }
  next();
}

export function libraryRouter(library: ReadingLibrary) {
  const router = express.Router();
  const token = randomBytes(32).toString("hex");
  router.use((_req, res, next) => { res.setHeader("Cache-Control", "no-store"); next(); });
  router.post("/session", (req, res) => {
    // JSON is required even for bootstrap: cross-site simple forms cannot obtain a session.
    if (!req.is("application/json")) { res.sendStatus(403); return; }
    res.json({ token });
  });
  router.use((req, res, next) => {
    if (req.headers["x-got-it-session"] !== token) { res.status(401).json({ error: "阅读会话已过期，请重试。" }); return; }
    if (req.method !== "GET" && !req.is("application/json")) { res.sendStatus(415); return; }
    next();
  });
  router.use(express.json({ limit: "24mb" }));
  const action = (fn: (req: Request) => Promise<unknown>) => async (req: Request, res: Response) => {
    try { res.json(await fn(req)); } catch (error) { const e = libraryFailure(error); res.status(e.status).json({ error: e.message, code: e.code }); }
  };
  const id = (req: Request) => String(req.params.id);
  router.get("/", action(() => library.list()));
  router.get("/recoveries", action(() => library.listRecoveries()));
  router.get("/recoveries/:id", action(req => library.getRecovery(id(req))));
  router.post("/recoveries/:id/resolve", action(req => library.resolveRecovery(id(req), req.body?.choice, req.body?.expectedVersion)));
  router.post("/entries/:id/recover", action(req => library.recover(id(req), req.body)));
  router.post("/choose", action(() => library.choose()));
  router.post("/entries", action(req => library.add(req.body?.workspace, req.body?.creationKey, req.body?.selectionId)));
  router.get("/entries/:id", action(req => library.get(id(req))));
  router.post("/entries/:id/activate", action(req => library.activate(id(req))));
  router.post("/entries/:id/save", action(req => library.save(id(req), req.body?.expectedVersion, req.body?.revisionId, req.body?.workspace, req.body?.position)));
  router.post("/entries/:id/check", action(req => library.check(id(req))));
  router.post("/entries/:id/relink", action(req => library.relink(id(req), req.body?.selectionId, req.body?.expectedVersion)));
  router.post("/entries/:id/update", action(req => library.updateSource(id(req), req.body?.candidateId, req.body?.expectedVersion)));
  router.use((err: {type?: string}, _req: Request, res: Response, _next: NextFunction) => res.status(err.type === "entity.too.large" ? 413 : 400).json({ error: "阅读请求过大或格式无效。" }));
  return router;
}
