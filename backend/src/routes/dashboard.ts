import { Router, Request, Response } from "express";
import { Campaign } from "../models/Campaign.js";
import { Lead } from "../models/Lead.js";
import { requireAuth } from "../middleware/auth.js";
import { isDbConnected } from "../config/db.js";
import { inMemoryCampaigns, inMemoryLeads } from "../pipeline/runCampaign.js";

export const dashboardRouter = Router();

function campaignsWithLiveCounts(campaigns: any[], leads: any[]) {
  const counts = new Map<string, { total: number; hot: number; warm: number; cold: number; scored: number }>();
  for (const lead of leads) {
    const id = String(lead.campaignId);
    const row = counts.get(id) || { total: 0, hot: 0, warm: 0, cold: 0, scored: 0 };
    const score = lead.score?.total || 0;
    const tier = lead.score?.tier || (score >= 70 ? "hot" : score >= 45 ? "warm" : "cold");
    row.total += 1;
    if (lead.score?.total != null) row.scored += 1;
    if (tier === "hot") row.hot += 1;
    else if (tier === "warm") row.warm += 1;
    else row.cold += 1;
    counts.set(id, row);
  }

  return campaigns.map((campaign) => {
    const plain = typeof campaign.toObject === "function" ? campaign.toObject() : { ...campaign };
    const id = String(plain._id || plain.id);
    const row = counts.get(id) || { total: 0, hot: 0, warm: 0, cold: 0, scored: 0 };
    plain.leadCount = row.total;
    plain.stats = {
      ...(plain.stats || {}),
      found: row.total,
      scored: row.scored,
      hot: row.hot,
      warm: row.warm,
      cold: row.cold
    };
    return plain;
  });
}

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
      const campaignTitles = new Map(userCampaigns.map((item) => [item._id.toString(), item.title]));
      const companies: Array<{
        name: string;
        domain: string;
        tier: string;
        score: number;
        campaignId: string;
        campaignTitle: string;
        industry: string;
      }> = [];

      for (const lead of leads) {
        const score = lead.score?.total || 0;
        totalScoreSum += score;
        const tier = lead.score?.tier || (score >= 70 ? "hot" : score >= 45 ? "warm" : "cold");

        if (tier === "hot") hot++;
        else if (tier === "warm") warm++;
        else cold++;

        companies.push({
          name: lead.name,
          domain: lead.domain,
          tier,
          score,
          campaignId: lead.campaignId,
          campaignTitle: campaignTitles.get(lead.campaignId) || "Campaign",
          industry: lead.score?.industry || ""
        });

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
        recentCampaigns: campaignsWithLiveCounts(userCampaigns, leads).slice(0, 5),
        companies: companies.sort((a, b) => b.score - a.score).slice(0, 40)
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

  const campaignTitles = new Map(userCampaigns.map((item) => [String(item._id || item.id), item.title]));
  const companies: Array<{
    name: string;
    domain: string;
    tier: string;
    score: number;
    campaignId: string;
    campaignTitle: string;
    industry: string;
  }> = [];

  for (const lead of allLeads) {
    const score = lead.score?.total || 0;
    totalScoreSum += score;
    const tier = lead.score?.tier || (score >= 70 ? "hot" : score >= 45 ? "warm" : "cold");
    if (tier === "hot") hot++;
    else if (tier === "warm") warm++;
    else cold++;
    companies.push({
      name: lead.name,
      domain: lead.domain,
      tier,
      score,
      campaignId: lead.campaignId,
      campaignTitle: campaignTitles.get(String(lead.campaignId)) || "Campaign",
      industry: lead.score?.industry || ""
    });

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
    recentCampaigns: campaignsWithLiveCounts(userCampaigns, allLeads).slice(0, 5),
    companies: companies.sort((a, b) => b.score - a.score).slice(0, 40)
  });
});
