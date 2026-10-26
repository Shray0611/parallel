import { Router, Request, Response } from "express";
import { isDbConnected } from "../config/db.js";
import { env } from "../config/env.js";
import { GroqService } from "../services/groq.service.js";
import { ParallelService } from "../services/parallel.service.js";

export const healthRouter = Router();

healthRouter.get("/", async (_req: Request, res: Response) => {
  const dbOk = isDbConnected();

  let groqStatus: "ok" | "failed" | "unconfigured" = "unconfigured";
  if (env.GROQ_API_KEY && env.GROQ_API_KEY.trim().length > 0) {
    const ok = await GroqService.ping();
    groqStatus = ok ? "ok" : "failed";
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
      groq: groqStatus,
      parallel: parallelStatus
    }
  });
});
