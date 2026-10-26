import { Router, Request, Response } from "express";
import { Campaign } from "../models/Campaign.js";
import { Lead } from "../models/Lead.js";
import { requireAuth } from "../middleware/auth.js";
import { isDbConnected } from "../config/db.js";
import { inMemoryCampaigns, inMemoryLeads } from "../pipeline/runCampaign.js";

export const dashboardRouter = Router();

// GET /api/dashboard/summary
dashboardRouter.get("/summary", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const userId = req.user!.id;

  if (isDbConnected()) {
    try {
      const userCampaigns = await Campaign.find({ userId }).sort({ createdAt: -1 });
      const campaignIds = userCampaigns.map((c) => c._id.toString());

      const leads = await Lead.find({ campaignId: { $in: campaignIds } });

      let totalScoreSum = 0;
      let hot = 0;
      let warm = 0;
      let cold = 0;
      const industryCounts = new Map<string, number>();
      const histogram = [
        { range: "0-20", count: 0 },
        { range: "21-40", count: 0 },
        { range: "41-60", count: 0 },
        { range: "61-80", count: 0 },
        { range: "81-100", count: 0 }
      ];

      for (const lead of leads) {
        const score = lead.score?.total || 0;
        totalScoreSum += score;

        if (lead.score?.tier === "hot" || score >= 70) hot++;
        else if (lead.score?.tier === "warm" || score >= 45) warm++;
        else cold++;

        // Industry aggregation
        const ind = lead.score?.industry || "Enterprise";
        industryCounts.set(ind, (industryCounts.get(ind) || 0) + 1);

        // Histogram binning
        if (score <= 20) histogram[0].count++;
        else if (score <= 40) histogram[1].count++;
        else if (score <= 60) histogram[2].count++;
        else if (score <= 80) histogram[3].count++;
        else histogram[4].count++;
      }

      const topIndustries = Array.from(industryCounts.entries())
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 5);

      const avgScore = leads.length > 0 ? Math.round(totalScoreSum / leads.length) : 0;

      res.json({
        totals: {
          campaigns: userCampaigns.length,
          leads: leads.length,
          hotLeads: hot,
          warmLeads: warm,
          coldLeads: cold,
          avgScore
        },
        tierDistribution: [
          { name: "Hot (≥70)", value: hot, fill: "#ef4444" },
          { name: "Warm (45-69)", value: warm, fill: "#f59e0b" },
          { name: "Cold (<45)", value: cold, fill: "#6b7280" }
        ],
        topIndustries,
        scoreHistogram: histogram,
        recentCampaigns: userCampaigns.slice(0, 5)
      });
      return;
    } catch (err: any) {
      res.status(500).json({ error: { message: err.message, code: "SUMMARY_FAILED" } });
      return;
    }
  }

  // Fallback in-memory
  const userCampaigns = Array.from(inMemoryCampaigns.values())
    .filter((c) => c.userId === userId)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  const allLeads: any[] = [];
  for (const c of userCampaigns) {
    const cId = c._id || c.id;
    const leads = inMemoryLeads.get(cId) || [];
    allLeads.push(...leads);
  }

  let totalScoreSum = 0;
  let hot = 0;
  let warm = 0;
  let cold = 0;
  const industryCounts = new Map<string, number>();
  const histogram = [
    { range: "0-20", count: 0 },
    { range: "21-40", count: 0 },
    { range: "41-60", count: 0 },
    { range: "61-80", count: 0 },
    { range: "81-100", count: 0 }
  ];

  for (const lead of allLeads) {
    const score = lead.score?.total || 0;
    totalScoreSum += score;
    if (lead.score?.tier === "hot" || score >= 70) hot++;
    else if (lead.score?.tier === "warm" || score >= 45) warm++;
    else cold++;

    const ind = lead.score?.industry || "Enterprise";
    industryCounts.set(ind, (industryCounts.get(ind) || 0) + 1);

    if (score <= 20) histogram[0].count++;
    else if (score <= 40) histogram[1].count++;
    else if (score <= 60) histogram[2].count++;
    else if (score <= 80) histogram[3].count++;
    else histogram[4].count++;
  }

  res.json({
    totals: {
      campaigns: userCampaigns.length,
      leads: allLeads.length,
      hotLeads: hot,
      warmLeads: warm,
      coldLeads: cold,
      avgScore: allLeads.length > 0 ? Math.round(totalScoreSum / allLeads.length) : 0
    },
    tierDistribution: [
      { name: "Hot (≥70)", value: hot, fill: "#ef4444" },
      { name: "Warm (45-69)", value: warm, fill: "#f59e0b" },
      { name: "Cold (<45)", value: cold, fill: "#6b7280" }
    ],
    topIndustries: Array.from(industryCounts.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5),
    scoreHistogram: histogram,
    recentCampaigns: userCampaigns.slice(0, 5)
  });
});
