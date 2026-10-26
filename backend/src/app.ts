import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import { healthRouter } from "./routes/health.js";
import { authRouter } from "./routes/auth.js";
import { campaignRouter } from "./routes/campaigns.js";
import { leadRouter } from "./routes/leads.js";
import { dashboardRouter } from "./routes/dashboard.js";
import { logger } from "./config/logger.js";

export const app = express();

app.use(cors({
  origin: true,
  credentials: true
}));
app.use(express.json({ limit: "10mb" }));

// Request logging middleware
app.use((req: Request, _res: Response, next: NextFunction) => {
  logger.debug({ method: req.method, path: req.path }, "Incoming request");
  next();
});

// Mount routes
app.use("/api/health", healthRouter);
app.use("/health", healthRouter);
app.use("/api/auth", authRouter);
app.use("/api/campaigns", campaignRouter);
app.use("/api/leads", leadRouter);
app.use("/api/dashboard", dashboardRouter);

// 404 Handler
app.use((_req: Request, res: Response) => {
  res.status(404).json({
    error: {
      message: "Route not found",
      code: "NOT_FOUND"
    }
  });
});

// Global Error Handler
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  logger.error({ err }, "Unhandled server error");
  res.status(500).json({
    error: {
      message: err.message || "Internal server error",
      code: "INTERNAL_SERVER_ERROR"
    }
  });
});
