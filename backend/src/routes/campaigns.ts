import { Router, Request, Response } from "express";
import crypto from "crypto";
import { z } from "zod";
import { Campaign } from "../models/Campaign.js";
import { Lead } from "../models/Lead.js";
import { requireAuth } from "../middleware/auth.js";
import { runCampaign, findMoreLeads, rerunObjective, inMemoryCampaigns, inMemoryLeads } from "../pipeline/runCampaign.js";
import { GeminiService } from "../services/gemini.service.js";
import { eventBus } from "../pipeline/eventBus.js";
import { isDbConnected } from "../config/db.js";
import { logger } from "../config/logger.js";

export const campaignRouter = Router();

function getParamId(param: string | string[] | undefined): string {
  if (Array.isArray(param)) return param[0] || "";
  return param || "";
}

// Campaign Creation validation
const filtersSchema = z.object({
  country: z.string().default("IN"),
  city: z.string().optional(),
  companySize: z.enum(["1-50", "51-200", "201-1000", "1001-5000", "5000+"]).default("51-200"),
  domains: z.array(z.string()).default([])
});

const searchObjectiveSchema = z.object({
  domain: z.string().optional().default(""),
  objective: z.string().min(5),
  rationale: z.string().optional().default(""),
  queries: z.array(z.string()).default([])
});

const icpSchema = z.object({
  summary: z.string(),
  painPoints: z.array(z.string()).default([]),
  buyerPersonas: z.array(z.string()).default([]),
  disqualifiers: z.array(z.string()).default([])
});

const createCampaignSchema = z.object({
  title: z.string().min(2, "Title is required"),
  offering: z.string().min(5, "Product offering description is required"),
  valueProps: z.array(z.string()).default([]),
  filters: filtersSchema,
  icp: icpSchema.optional(),
  searchObjectives: z.array(searchObjectiveSchema).optional()
});

const previewSchema = z.object({
  offering: z.string().min(5),
  valueProps: z.array(z.string()).default([]),
  filters: filtersSchema,
  fresh: z.boolean().optional()
});

// GET /api/campaigns — list user's campaigns, newest first
campaignRouter.get("/", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const userId = req.user!.id;

  if (isDbConnected()) {
    try {
      const campaigns = await Campaign.find({ userId }).sort({ createdAt: -1 });
      res.json({ campaigns });
      return;
    } catch (err: any) {
      res.status(500).json({ error: { message: err.message, code: "FETCH_FAILED" } });
      return;
    }
  }

  // Fallback in-memory
  const list = Array.from(inMemoryCampaigns.values())
    .filter((c) => c.userId === userId)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  res.json({ campaigns: list });
});

// POST /api/campaigns — create draft campaign
campaignRouter.post("/", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const parsed = createCampaignSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: {
        message: parsed.error.errors[0]?.message || "Invalid campaign data",
        code: "VALIDATION_ERROR"
      }
    });
    return;
  }

  const userId = req.user!.id;
  const { title, offering, valueProps, filters, icp, searchObjectives } = parsed.data;
  const sessionId = `session-${crypto.randomUUID()}`;

  const campaignData = {
    userId,
    title,
    offering,
    valueProps,
    filters,
    ...(icp ? { icp } : {}),
    ...(searchObjectives?.length ? { searchObjectives } : {}),
    status: "draft" as const,
    sessionId,
    progress: {
      stage: "icp" as const,
      current: 0,
      total: 5,
      message: "Ready to start discovery"
    },
    stats: {
      found: 0,
      enriched: 0,
      scored: 0,
      hot: 0,
      warm: 0,
      cold: 0,
      apiCalls: {
        groq: 0,
        parallelEntity: 0,
        parallelSearch: 0,
        parallelFindAll: 0,
        parallelExtract: 0,
        parallelTask: 0,
        parallelMonitor: 0
      }
    }
  };

  if (isDbConnected()) {
    try {
      const campaign = await Campaign.create(campaignData);
      res.status(201).json({ campaign });
      return;
    } catch (err: any) {
      res.status(500).json({ error: { message: err.message, code: "CREATE_FAILED" } });
      return;
    }
  }

  // Fallback in-memory
  const id = `campaign-${Date.now()}`;
  const mockCampaign = {
    ...campaignData,
    _id: id,
    id,
    createdAt: new Date().toISOString()
  };
  inMemoryCampaigns.set(id, mockCampaign);
  res.status(201).json({ campaign: mockCampaign });
});

// POST /api/campaigns/preview-objectives — LLM plan shown before a run is sent
campaignRouter.post("/preview-objectives", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const parsed = previewSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: {
        message: parsed.error.errors[0]?.message || "Invalid preview data",
        code: "VALIDATION_ERROR"
      }
    });
    return;
  }

  const { offering, valueProps, filters, fresh } = parsed.data;
  try {
    const plan = await GeminiService.generateICP(offering, valueProps, filters, { fresh: Boolean(fresh) });
    res.json(plan);
  } catch (err: any) {
    logger.error({ err }, "Failed to preview search objectives");
    res.status(502).json({
      error: {
        message: err.message || "Could not generate search objectives",
        code: "PREVIEW_FAILED"
      }
    });
  }
});

// GET /api/campaigns/:id — fetch single campaign
campaignRouter.get("/:id", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const id = getParamId(req.params.id);

  if (isDbConnected()) {
    try {
      const campaign = await Campaign.findById(id);
      if (!campaign) {
        res.status(404).json({ error: { message: "Campaign not found", code: "NOT_FOUND" } });
        return;
      }
      res.json({ campaign });
      return;
    } catch (err: any) {
      res.status(500).json({ error: { message: err.message, code: "FETCH_FAILED" } });
      return;
    }
  }

  const campaign = inMemoryCampaigns.get(id);
  if (!campaign) {
    res.status(404).json({ error: { message: "Campaign not found", code: "NOT_FOUND" } });
    return;
  }
  res.json({ campaign });
});

// POST /api/campaigns/:id/run — returns 202 immediately, launches background pipeline
campaignRouter.post("/:id/run", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const id = getParamId(req.params.id);

  let exists = false;
  if (isDbConnected()) {
    exists = Boolean(await Campaign.findById(id));
  } else {
    exists = inMemoryCampaigns.has(id);
  }

  if (!exists) {
    res.status(404).json({ error: { message: "Campaign not found", code: "NOT_FOUND" } });
    return;
  }

  // Trigger asynchronously without blocking response
  setImmediate(() => {
    runCampaign(id).catch((err) => {
      logger.error({ err, campaignId: id }, "Background campaign run error");
    });
  });

  res.status(202).json({
    message: "Campaign run started",
    campaignId: id
  });
});

// GET /api/campaigns/:id/events — Server-Sent Events (SSE)
campaignRouter.get("/:id/events", (req: Request, res: Response): void => {
  const id = getParamId(req.params.id);

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  // Keep-alive heartbeat every 15s to prevent gateway timeout
  const heartbeat = setInterval(() => {
    res.write(": keepalive\n\n");
  }, 15000);

  const onProgress = (data: any) => {
    if (data.campaignId === id) {
      res.write(`event: progress\ndata: ${JSON.stringify(data)}\n\n`);
    }
  };

  const onLeadAdded = (data: any) => {
    if (data.campaignId === id) {
      res.write(`event: lead_added\ndata: ${JSON.stringify(data)}\n\n`);
    }
  };

  const onLeadScored = (data: any) => {
    if (data.campaignId === id) {
      res.write(`event: lead_scored\ndata: ${JSON.stringify(data)}\n\n`);
    }
  };

  const onDone = (data: any) => {
    if (data.campaignId === id) {
      res.write(`event: done\ndata: ${JSON.stringify(data)}\n\n`);
    }
  };

  const onError = (data: any) => {
    if (data.campaignId === id) {
      res.write(`event: error\ndata: ${JSON.stringify(data)}\n\n`);
    }
  };

  eventBus.on("progress", onProgress);
  eventBus.on("lead_added", onLeadAdded);
  eventBus.on("lead_scored", onLeadScored);
  eventBus.on("done", onDone);
  eventBus.on("error", onError);

  req.on("close", () => {
    clearInterval(heartbeat);
    eventBus.removeListener("progress", onProgress);
    eventBus.removeListener("lead_added", onLeadAdded);
    eventBus.removeListener("lead_scored", onLeadScored);
    eventBus.removeListener("done", onDone);
    eventBus.removeListener("error", onError);
  });
});

// DELETE /api/campaigns/:id — remove campaign & its leads
campaignRouter.delete("/:id", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const id = getParamId(req.params.id);

  if (isDbConnected()) {
    try {
      await Lead.deleteMany({ campaignId: id });
      await Campaign.findByIdAndDelete(id);
      res.json({ message: "Campaign deleted successfully" });
      return;
    } catch (err: any) {
      res.status(500).json({ error: { message: err.message, code: "DELETE_FAILED" } });
      return;
    }
  }

  inMemoryCampaigns.delete(id);
  inMemoryLeads.delete(id);
  res.json({ message: "Campaign deleted successfully" });
});

// GET /api/campaigns/:id/leads — filtered, sorted, paginated leads
campaignRouter.get("/:id/leads", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const id = getParamId(req.params.id);
  const {
    tier,
    status,
    minScore,
    industry,
    q,
    sort = "-score.total",
    page = "1",
    limit = "50"
  } = req.query;

  if (isDbConnected()) {
    try {
      const filter: any = { campaignId: id };

      if (tier) filter["score.tier"] = tier;
      if (status) filter.status = status;
      if (industry) filter["score.industry"] = new RegExp(String(industry), "i");
      if (minScore) filter["score.total"] = { $gte: Number(minScore) };
      if (q) {
        const query = String(q);
        filter.$or = [
          { name: new RegExp(query, "i") },
          { domain: new RegExp(query, "i") },
          { description: new RegExp(query, "i") }
        ];
      }

      const pageNum = Math.max(1, parseInt(String(page), 10));
      const pageSize = Math.max(1, parseInt(String(limit), 10));
      const skip = (pageNum - 1) * pageSize;

      // Sorting
      let sortObj: any = { "score.total": -1 };
      if (sort === "name") sortObj = { name: 1 };
      else if (sort === "-name") sortObj = { name: -1 };
      else if (sort === "score.total") sortObj = { "score.total": 1 };
      else if (sort === "-score.total") sortObj = { "score.total": -1 };

      const [leads, total] = await Promise.all([
        Lead.find(filter).sort(sortObj).skip(skip).limit(pageSize),
        Lead.countDocuments(filter)
      ]);

      res.json({
        leads,
        pagination: {
          total,
          page: pageNum,
          limit: pageSize,
          pages: Math.ceil(total / pageSize)
        }
      });
      return;
    } catch (err: any) {
      res.status(500).json({ error: { message: err.message, code: "FETCH_LEADS_FAILED" } });
      return;
    }
  }

  // Fallback in-memory
  const all = inMemoryLeads.get(id) || [];
  let filtered = [...all];

  if (tier) filtered = filtered.filter((l) => l.score?.tier === tier);
  if (status) filtered = filtered.filter((l) => l.status === status);
  if (minScore) filtered = filtered.filter((l) => (l.score?.total || 0) >= Number(minScore));
  if (q) {
    const query = String(q).toLowerCase();
    filtered = filtered.filter(
      (l) =>
        l.name?.toLowerCase().includes(query) ||
        l.domain?.toLowerCase().includes(query) ||
        l.description?.toLowerCase().includes(query)
    );
  }

  res.json({
    leads: filtered,
    pagination: {
      total: filtered.length,
      page: 1,
      limit: 50,
      pages: 1
    }
  });
});

// GET /api/campaigns/:id/export.csv — CSV export
campaignRouter.get("/:id/export.csv", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const id = getParamId(req.params.id);

  let leads: any[] = [];
  if (isDbConnected()) {
    leads = await Lead.find({ campaignId: id }).sort({ "score.total": -1 });
  } else {
    leads = inMemoryLeads.get(id) || [];
  }

  const csvRows = [
    [
      "Company Name",
      "Website",
      "Domain",
      "Industry",
      "Size",
      "Location",
      "Total Score",
      "Fit",
      "Intent",
      "Reachability",
      "Tier",
      "Status",
      "Why Now",
      "Pitch Angle",
      "Outreach Subject",
      "Outreach Email"
    ].join(",")
  ];

  for (const lead of leads) {
    const escapeCsv = (str: any) => `"${String(str || "").replace(/"/g, '""').replace(/\n/g, " ")}"`;

    csvRows.push(
      [
        escapeCsv(lead.name),
        escapeCsv(lead.website),
        escapeCsv(lead.domain),
        escapeCsv(lead.score?.industry),
        escapeCsv(lead.score?.estimatedSize),
        escapeCsv(lead.score?.location),
        lead.score?.total || 0,
        lead.score?.fit || 0,
        lead.score?.intent || 0,
        lead.score?.reachability || 0,
        escapeCsv(lead.score?.tier),
        escapeCsv(lead.status),
        escapeCsv(lead.score?.whyNow),
        escapeCsv(lead.score?.pitchAngle),
        escapeCsv(lead.outreach?.subject),
        escapeCsv(lead.outreach?.email)
      ].join(",")
    );
  }

  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", `attachment; filename=leads-campaign-${id}.csv`);
  res.send(csvRows.join("\n"));
});

// -----------------------------------------------------------------------------
// POST /api/campaigns/:id/queries/:index/find-more
// -----------------------------------------------------------------------------
campaignRouter.post("/:id/queries/:index/find-more", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const id = getParamId(req.params.id);
  const objectiveIndex = parseInt(String(req.params.index), 10);
  if (isNaN(objectiveIndex) || objectiveIndex < 0) {
    res.status(400).json({ error: { message: "Invalid objective index", code: "INVALID_INDEX" } });
    return;
  }
  let campaign: any = null;
  if (isDbConnected()) { campaign = await Campaign.findById(id); }
  else { campaign = inMemoryCampaigns.get(id); }
  if (!campaign) {
    res.status(404).json({ error: { message: "Campaign not found", code: "NOT_FOUND" } });
    return;
  }
  if (campaign.status === "running") {
    res.status(409).json({ error: { message: "Pipeline is currently running", code: "PIPELINE_RUNNING" } });
    return;
  }
  res.status(202).json({ message: "Finding more leads...", campaignId: id, objectiveIndex });
  setImmediate(() => {
    findMoreLeads(id, objectiveIndex).catch((err) => {
      logger.error({ err, campaignId: id, objectiveIndex }, "Find more leads failed");
      eventBus.emitError({ campaignId: id, message: `Find more leads failed: ${err.message}` });
    });
  });
});

// -----------------------------------------------------------------------------
// PUT /api/campaigns/:id/queries/:index � update a search objective text
// -----------------------------------------------------------------------------
campaignRouter.put("/:id/queries/:index", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const id = getParamId(req.params.id);
  const objectiveIndex = parseInt(String(req.params.index), 10);
  const { objective, rationale } = req.body;
  if (!objective || typeof objective !== "string" || objective.trim().length < 5) {
    res.status(400).json({ error: { message: "Objective text is required (min 5 chars)", code: "VALIDATION_ERROR" } });
    return;
  }
  if (isNaN(objectiveIndex) || objectiveIndex < 0) {
    res.status(400).json({ error: { message: "Invalid objective index", code: "INVALID_INDEX" } });
    return;
  }
  if (isDbConnected()) {
    const campaign = await Campaign.findById(id);
    if (!campaign) { res.status(404).json({ error: { message: "Campaign not found", code: "NOT_FOUND" } }); return; }
    if (!campaign.searchObjectives || !campaign.searchObjectives[objectiveIndex]) {
      res.status(404).json({ error: { message: "Objective index not found", code: "NOT_FOUND" } }); return;
    }
    campaign.searchObjectives[objectiveIndex].objective = objective.trim();
    if (rationale) campaign.searchObjectives[objectiveIndex].rationale = rationale.trim();
    if ((campaign as any).findallRunIds) (campaign as any).findallRunIds[objectiveIndex] = "";
    await campaign.save();
    res.json({ campaign });
    return;
  }
  const campaign = inMemoryCampaigns.get(id);
  if (!campaign || !campaign.searchObjectives?.[objectiveIndex]) {
    res.status(404).json({ error: { message: "Campaign or objective not found", code: "NOT_FOUND" } }); return;
  }
  campaign.searchObjectives[objectiveIndex].objective = objective.trim();
  if (rationale) campaign.searchObjectives[objectiveIndex].rationale = rationale.trim();
  if (campaign.findallRunIds) campaign.findallRunIds[objectiveIndex] = "";
  inMemoryCampaigns.set(id, campaign);
  res.json({ campaign });
});

// -----------------------------------------------------------------------------
// POST /api/campaigns/:id/queries/:index/rerun � rerun a specific query fresh
// -----------------------------------------------------------------------------
campaignRouter.post("/:id/queries/:index/rerun", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const id = getParamId(req.params.id);
  const objectiveIndex = parseInt(String(req.params.index), 10);
  if (isNaN(objectiveIndex) || objectiveIndex < 0) {
    res.status(400).json({ error: { message: "Invalid objective index", code: "INVALID_INDEX" } });
    return;
  }
  let campaign: any = null;
  if (isDbConnected()) { campaign = await Campaign.findById(id); }
  else { campaign = inMemoryCampaigns.get(id); }
  if (!campaign) { res.status(404).json({ error: { message: "Campaign not found", code: "NOT_FOUND" } }); return; }
  if (campaign.status === "running") {
    res.status(409).json({ error: { message: "Pipeline is currently running", code: "PIPELINE_RUNNING" } });
    return;
  }
  res.status(202).json({ message: "Re-running query...", campaignId: id, objectiveIndex });
  setImmediate(() => {
    rerunObjective(id, objectiveIndex).catch((err) => {
      logger.error({ err, campaignId: id, objectiveIndex }, "Rerun objective failed");
      eventBus.emitError({ campaignId: id, message: `Rerun failed: ${err.message}` });
    });
  });
});