import { Router, Request, Response } from "express";
import { isDbConnected } from "../config/db.js";
import { env } from "../config/env.js";
import { GeminiService } from "../services/gemini.service.js";
import { ParallelService } from "../services/parallel.service.js";

export const healthRouter = Router();

healthRouter.get("/", async (_req: Request, res: Response) => {
  const dbOk = isDbConnected();

  let geminiStatus: "ok" | "failed" | "unconfigured" = "unconfigured";
  if (env.GEMINI_API_KEY && env.GEMINI_API_KEY.trim().length > 0) {
    const ok = await GeminiService.ping();
    geminiStatus = ok ? "ok" : "failed";
  }

  let parallelStatus: "ok" | "failed" | "unconfigured" = "unconfigured";
  if (env.PARALLEL_API_KEY && env.PARALLEL_API_KEY.trim().length > 0) {
    const ok = await ParallelService.ping();
    parallelStatus = ok ? "ok" : "failed";
  }

  const isHealthy = dbOk || env.DEMO_MODE;

  res.status(isHealthy ? 200 : 503).json({
    status: isHealthy ? "ok" : "degraded",
    timestamp: new Date().toISOString(),
    demoMode: env.DEMO_MODE,
    services: {
      database: dbOk ? "connected" : "disconnected",
      gemini: geminiStatus,
      groq: geminiStatus, // fallback for legacy clients
      parallel: parallelStatus
    }
  });
});
