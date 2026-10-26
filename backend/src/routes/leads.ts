import { Router, Request, Response } from "express";
import { z } from "zod";
import { Lead } from "../models/Lead.js";
import { Campaign } from "../models/Campaign.js";
import { requireAuth } from "../middleware/auth.js";
import { GeminiService } from "../services/gemini.service.js";
import { isDbConnected } from "../config/db.js";
import { inMemoryLeads } from "../pipeline/runCampaign.js";

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
