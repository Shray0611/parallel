import { Router, Request, Response } from "express";
import { z } from "zod";
import { Lead } from "../models/Lead.js";
import { Campaign } from "../models/Campaign.js";
import { requireAuth } from "../middleware/auth.js";
import { GeminiService } from "../services/gemini.service.js";
import { ParallelService } from "../services/parallel.service.js";
import { env } from "../config/env.js";
import { isDbConnected } from "../config/db.js";
import { inMemoryLeads } from "../pipeline/runCampaign.js";
import { logger } from "../config/logger.js";

export const leadRouter = Router();

function getParamId(param: string | string[] | undefined): string {
  if (Array.isArray(param)) return param[0] || "";
  return param || "";
}

const updateLeadSchema = z.object({
  status: z.enum(["new", "contacted", "replied", "qualified", "lost"]).optional(),
  notes: z.string().optional(),
  assignedTo: z.string().optional()
});

const regenerateSchema = z.object({
  tone: z.enum(["formal", "friendly", "short"]).default("formal")
});

async function attachMonitorUpdates(lead: any): Promise<any> {
  const monitorId = String(lead?.monitorId || "");
  if (!monitorId || monitorId.startsWith("monitor-demo")) return lead;

  const checkedAt = lead.monitorCheckedAt ? new Date(lead.monitorCheckedAt).getTime() : 0;
  if (checkedAt && Date.now() - checkedAt < 2 * 60 * 1000) return lead;

  try {
    const updates = await ParallelService.listMonitorEvents(monitorId, 8);
    lead.monitorUpdates = updates;
    lead.monitorCheckedAt = new Date();
    if (isDbConnected() && lead.save) {
      await lead.save();
    }
  } catch (err) {
    logger.warn({ err, monitorId }, "Monitor events could not be loaded");
  }
  return lead;
}

// GET /api/leads/:id
leadRouter.get("/:id", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const id = getParamId(req.params.id);

  if (isDbConnected()) {
    try {
      const lead = await Lead.findById(id);
      if (!lead) {
        res.status(404).json({ error: { message: "Lead not found", code: "NOT_FOUND" } });
        return;
      }
      await attachMonitorUpdates(lead);
      res.json({ lead });
      return;
    } catch (err: any) {
      res.status(500).json({ error: { message: err.message, code: "FETCH_FAILED" } });
      return;
    }
  }

  // Fallback in-memory
  for (const leads of inMemoryLeads.values()) {
    const found = leads.find((l) => l._id === id || l.id === id);
    if (found) {
      await attachMonitorUpdates(found);
      res.json({ lead: found });
      return;
    }
  }

  res.status(404).json({ error: { message: "Lead not found", code: "NOT_FOUND" } });
});

// PATCH /api/leads/:id
leadRouter.patch("/:id", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const id = getParamId(req.params.id);
  const parsed = updateLeadSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({
      error: {
        message: parsed.error.errors[0]?.message || "Invalid update data",
        code: "VALIDATION_ERROR"
      }
    });
    return;
  }

  if (isDbConnected()) {
    try {
      const lead = await Lead.findByIdAndUpdate(id, parsed.data, { new: true });
      if (!lead) {
        res.status(404).json({ error: { message: "Lead not found", code: "NOT_FOUND" } });
        return;
      }
      res.json({ lead });
      return;
    } catch (err: any) {
      res.status(500).json({ error: { message: err.message, code: "UPDATE_FAILED" } });
      return;
    }
  }

  // Fallback in-memory
  for (const leads of inMemoryLeads.values()) {
    const found = leads.find((l) => l._id === id || l.id === id);
    if (found) {
      Object.assign(found, parsed.data);
      res.json({ lead: found });
      return;
    }
  }

  res.status(404).json({ error: { message: "Lead not found", code: "NOT_FOUND" } });
});

const monitorSchema = z.object({
  enabled: z.boolean()
});

async function findLead(id: string): Promise<any | null> {
  if (isDbConnected()) return Lead.findById(id);
  for (const leads of inMemoryLeads.values()) {
    const found = leads.find((lead) => lead._id === id || lead.id === id);
    if (found) return found;
  }
  return null;
}

async function saveLead(lead: any): Promise<void> {
  if (isDbConnected() && lead.save) await lead.save();
}

// POST /api/leads/:id/monitor
leadRouter.post("/:id/monitor", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const id = getParamId(req.params.id);
  const parsed = monitorSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: { message: "Choose whether monitoring should be on or off", code: "VALIDATION_ERROR" } });
    return;
  }

  const lead = await findLead(id);
  if (!lead) {
    res.status(404).json({ error: { message: "Lead not found", code: "NOT_FOUND" } });
    return;
  }

  const enabled = parsed.data.enabled;
  const currentId = String(lead.monitorId || "");

  try {
    if (enabled) {
      if (!currentId || currentId.startsWith("monitor-demo")) {
        if (env.DEMO_MODE) {
          lead.monitorId = currentId || `monitor-demo-${id}`;
        } else {
          const created = await ParallelService.createMonitor(
            `Material changes, leadership hiring, funding, and expansion news for ${lead.name} (${lead.domain})`,
            "weekly"
          );
          lead.monitorId = created.id || created.monitor_id || "";
        }
      }
      lead.monitorEnabled = true;
    } else {
      if (currentId && !currentId.startsWith("monitor-demo") && !env.DEMO_MODE) {
        try {
          await ParallelService.cancelMonitor(currentId);
        } catch (err) {
          logger.warn({ err, monitorId: currentId }, "Monitor cancel failed");
        }
      }
      lead.monitorId = "";
      lead.monitorEnabled = false;
    }

    await saveLead(lead);
    res.json({ lead });
  } catch (err: any) {
    logger.warn({ err, leadId: id }, "Could not change lead monitor");
    res.status(502).json({ error: { message: err.message || "Could not change monitoring", code: "MONITOR_FAILED" } });
  }
});

// POST /api/leads/:id/regenerate-outreach
leadRouter.post("/:id/regenerate-outreach", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const id = getParamId(req.params.id);
  const parsed = regenerateSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({
      error: {
        message: parsed.error.errors[0]?.message || "Invalid tone option",
        code: "VALIDATION_ERROR"
      }
    });
    return;
  }

  const { tone } = parsed.data;

  let lead: any = null;
  let campaign: any = null;

  if (isDbConnected()) {
    lead = await Lead.findById(id);
    if (lead) {
      campaign = await Campaign.findById(lead.campaignId);
    }
  } else {
    for (const leads of inMemoryLeads.values()) {
      const found = leads.find((l) => l._id === id || l.id === id);
      if (found) {
        lead = found;
        break;
      }
    }
  }

  if (!lead) {
    res.status(404).json({ error: { message: "Lead not found", code: "NOT_FOUND" } });
    return;
  }

  const offering = campaign?.offering || "Enterprise AI Products & RAG Pipelines";
  const excerpts = (lead.enrichment?.results || []).flatMap((r: any) => r.excerpts || []);

  try {
    const newOutreach = await GeminiService.regenerateOutreach(
      lead.name,
      lead.description,
      lead.score?.pitchAngle || "Accelerate document intelligence workflows",
      lead.score?.whyNow || "Recent digital operations expansion",
      offering,
      excerpts,
      tone
    );

    lead.outreach = newOutreach;
    if (isDbConnected()) {
      await lead.save();
    }

    res.json({ outreach: newOutreach });
  } catch (err: any) {
    // Graceful fallback template in case Groq is unconfigured
    const tonePrefix = tone === "formal" ? "Dear" : tone === "short" ? "Quick note for" : "Hi";
    const fallback = {
      subject: `Accelerating ${offering} at ${lead.name}`,
      email: `${tonePrefix} ${lead.name} leadership,\n\nI noticed your active enterprise operations and recent digitization focus. Cerelabs provides specialized AI solutions to streamline core document workflows.\n\nCould we arrange a 15-minute briefing next week?\n\nBest,\nCerelabs Team`,
      linkedinNote: `Hi! Impressed by ${lead.name}'s technology roadmap. We build enterprise AI to automate document workflows. Let's connect!`
    };

    lead.outreach = fallback;
    if (isDbConnected()) {
      await lead.save();
    }
    res.json({ outreach: fallback });
  }
});
