import pLimit from "p-limit";
import { Campaign, ICampaign } from "../models/Campaign.js";
import { Lead, ILead } from "../models/Lead.js";
import { env } from "../config/env.js";
import { logger } from "../config/logger.js";
import { eventBus } from "./eventBus.js";
import { GeminiService } from "../services/gemini.service.js";
import { ParallelService } from "../services/parallel.service.js";
import { isDbConnected } from "../config/db.js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const fixturesPath = path.resolve(__dirname, "../demo/fixtures.json");
const fixturesData: any[] = JSON.parse(fs.readFileSync(fixturesPath, "utf-8"));

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function extractDomain(urlStr: string): string {
  try {
    const parsed = new URL(urlStr.startsWith("http") ? urlStr : `https://${urlStr}`);
    return parsed.hostname.replace(/^www\./i, "").toLowerCase();
  } catch {
    return urlStr.replace(/^(?:https?:\/\/)?(?:www\.)?/i, "").split("/")[0].toLowerCase();
  }
}

// In-memory fallback stores if MongoDB is offline
export const inMemoryCampaigns = new Map<string, any>();
export const inMemoryLeads = new Map<string, any[]>();

export async function runCampaign(campaignId: string): Promise<void> {
  logger.info({ campaignId, demoMode: env.DEMO_MODE }, "Starting campaign pipeline execution");

  let campaign: any = null;
  if (isDbConnected()) {
    campaign = await Campaign.findById(campaignId);
  } else {
    campaign = inMemoryCampaigns.get(campaignId);
  }

  if (!campaign) {
    logger.error({ campaignId }, "Campaign not found for pipeline run");
    eventBus.emitError({ campaignId, message: "Campaign not found" });
    return;
  }

  // Update status to running
  campaign.status = "running";
  campaign.progress = {
    stage: "icp",
    current: 1,
    total: 5,
    message: "Initializing AI discovery pipeline..."
  };

  if (isDbConnected()) {
    await campaign.save();
  } else {
    inMemoryCampaigns.set(campaignId, campaign);
  }

  eventBus.emitProgress({
    campaignId,
    stage: "icp",
    current: 1,
    total: 5,
    message: "Analyzing offering and defining target ICP..."
  });

  try {
    if (env.DEMO_MODE) {
      await runDemoPipeline(campaign);
    } else {
      await runLivePipeline(campaign);
    }
  } catch (err: any) {
    logger.error({ err, campaignId }, "Pipeline execution failed");
    campaign.status = "failed";
    campaign.progress.stage = "failed";
    campaign.progress.message = err.message || "Pipeline execution failed";

    if (isDbConnected()) {
      await campaign.save();
    } else {
      inMemoryCampaigns.set(campaignId, campaign);
    }

    eventBus.emitError({ campaignId, message: err.message || "Pipeline execution failed" });
  }
}

// ==========================================
// DEMO PIPELINE IMPLEMENTATION
// ==========================================
async function runDemoPipeline(campaign: any): Promise<void> {
  const campaignId = campaign._id ? campaign._id.toString() : campaign.id;
  logger.info({ campaignId }, "Running pipeline in DEMO_MODE with curated realistic fixtures");

  // Stage 1: ICP
  await sleep(400);
  campaign.icp = {
    summary: `Enterprise companies in ${campaign.filters?.country || "India"} with complex operational workflows that can be automated using ${campaign.offering}.`,
    painPoints: [
      "Manual multi-day document review cycles slowing down operational turnaround",
      "High human verification overhead in cross-checking regulatory and customer records",
      "Siloed institutional knowledge requiring senior specialist intervention"
    ],
    buyerPersonas: [
      "Chief Technology Officer (CTO)",
      "Head of Digital Transformation / Enterprise AI",
      "VP of Operations & Compliance"
    ],
    disqualifiers: [
      "Small companies with fewer than 50 employees without high document throughput",
      "Organizations without digital document infrastructure"
    ]
  };

  campaign.searchObjectives = [
    {
      objective: `Enterprise companies in ${campaign.filters?.country || "India"} (${campaign.filters?.companySize || "201-1000"} employees) with large internal document bases for ${campaign.offering}`,
      rationale: "Target high-density documentation enterprises with established compliance operations"
    },
    {
      objective: `Financial services, manufacturing, and tech companies in ${campaign.filters?.country || "India"} implementing digital automation initiatives`,
      rationale: "Organizations with active digital budgets and executive AI mandates"
    },
    {
      objective: `Healthcare, pharma, and regulated enterprises in ${campaign.filters?.country || "India"} requiring zero-hallucination compliance queries`,
      rationale: "High-value enterprise contracts requiring verifiable source citations"
    }
  ];

  campaign.progress = {
    stage: "discover",
    current: 2,
    total: 5,
    message: "Finding real matching companies via Parallel Entity Search..."
  };
  eventBus.emitProgress({
    campaignId,
    stage: "discover",
    current: 2,
    total: 5,
    message: "Discovered 3 targeted company search objectives. Finding entities..."
  });

  // Stage 2: Discover Leads from Fixtures
  await sleep(400);
  const leadsToLoad = fixturesData.slice(0, env.MAX_LEADS_PER_CAMPAIGN || 25);
  const createdLeads: any[] = [];

  for (let i = 0; i < leadsToLoad.length; i++) {
    const item = leadsToLoad[i];
    const domain = extractDomain(item.website || item.domain);

    const leadDocData = {
      campaignId,
      name: item.name,
      website: item.website,
      domain,
      description: item.description,
      sourceObjectiveIndex: i % 3,
      status: "new",
      notes: ""
    };

    let savedLead: any = null;
    if (isDbConnected()) {
      savedLead = await Lead.findOneAndUpdate(
        { campaignId, domain },
        { $setOnInsert: leadDocData },
        { upsert: true, new: true }
      );
    } else {
      savedLead = { ...leadDocData, _id: `lead-${Date.now()}-${i}` };
    }

    createdLeads.push(savedLead);
    eventBus.emitLeadAdded({ campaignId, lead: savedLead });
  }

  campaign.stats.found = createdLeads.length;
  campaign.stats.apiCalls.parallelEntity = 3;

  // Stage 3: Enrich with Live Web Search Data
  campaign.progress = {
    stage: "enrich",
    current: 3,
    total: 5,
    message: `Enriching ${createdLeads.length} companies with live web intelligence...`
  };
  eventBus.emitProgress({
    campaignId,
    stage: "enrich",
    current: 3,
    total: 5,
    message: `Running Parallel Search queries for ${createdLeads.length} companies...`
  });

  await sleep(400);
  for (let i = 0; i < createdLeads.length; i++) {
    const item = leadsToLoad[i];
    const lead = createdLeads[i];

    const enrichment = item.enrichment || {
      results: [
        {
          url: lead.website,
          title: `${lead.name} Enterprise Overview`,
          publishDate: "2026-01-01",
          excerpts: [`Active enterprise operations with ongoing modernization initiatives.`]
        }
      ],
      fetchedAt: new Date(),
      searchId: `demo-search-${i}`
    };

    if (isDbConnected()) {
      await Lead.findByIdAndUpdate(lead._id, { enrichment });
    }
    lead.enrichment = enrichment;
  }

  campaign.stats.enriched = createdLeads.length;
  campaign.stats.apiCalls.parallelSearch = createdLeads.length;

  // Stage 4: Score with Gemini & Draft Outreach
  campaign.progress = {
    stage: "score",
    current: 4,
    total: 5,
    message: "Evaluating ICP fit, buying signals & generating outreach drafts..."
  };
  eventBus.emitProgress({
    campaignId,
    stage: "score",
    current: 4,
    total: 5,
    message: "Scoring leads 0–100 and generating tailored pitch angles..."
  });

  let hotCount = 0;
  let warmCount = 0;
  let coldCount = 0;

  for (let i = 0; i < createdLeads.length; i++) {
    const item = leadsToLoad[i];
    const lead = createdLeads[i];

    const score = item.score || {
      total: 75,
      fit: 32,
      intent: 23,
      reachability: 20,
      tier: "hot",
      reasons: ["Strong industry alignment", "Active documentation needs"],
      whyNow: "Ongoing enterprise digital transformation",
      pitchAngle: `Deploy ${campaign.offering} to accelerate operations.`,
      recommendedProduct: campaign.offering,
      estimatedSize: "1001-5000",
      industry: "Enterprise",
      location: campaign.filters?.country || "India",
      risks: ["Procurement review timelines"]
    };

    const outreach = item.outreach || {
      subject: `Accelerating document intelligence for ${lead.name}`,
      email: `Hi ${lead.name} Team,\n\nWe build high-performance ${campaign.offering} tailored for enterprise workflows.\n\nBest,\nCerelabs Team`,
      linkedinNote: `Hi! Impressed by ${lead.name}'s growth. We build enterprise AI to automate document workflows. Let's connect!`
    };

    if (score.tier === "hot") hotCount++;
    else if (score.tier === "warm") warmCount++;
    else coldCount++;

    lead.score = score;
    lead.outreach = outreach;

    if (isDbConnected()) {
      await Lead.findByIdAndUpdate(lead._id, { score, outreach });
    }

    eventBus.emitLeadScored({ campaignId, lead });
    await sleep(80); // Smooth live UI stream effect
  }

  campaign.stats.scored = createdLeads.length;
  campaign.stats.hot = hotCount;
  campaign.stats.warm = warmCount;
  campaign.stats.cold = coldCount;
  campaign.stats.apiCalls.gemini = createdLeads.length + 1; // 1 for ICP + 1 per lead
  campaign.stats.apiCalls.groq = createdLeads.length + 1;

  // Stage 5: Finalise
  campaign.status = "completed";
  campaign.completedAt = new Date();
  campaign.progress = {
    stage: "completed",
    current: 5,
    total: 5,
    message: `Completed! Scored ${createdLeads.length} leads (${hotCount} hot, ${warmCount} warm, ${coldCount} cold).`
  };

  if (isDbConnected()) {
    await campaign.save();
  } else {
    inMemoryCampaigns.set(campaignId, campaign);
    inMemoryLeads.set(campaignId, createdLeads);
  }

  eventBus.emitDone({ campaignId, stats: campaign.stats });
  logger.info({ campaignId, stats: campaign.stats }, "Demo pipeline completed successfully");
}

// ==========================================
// LIVE PRODUCTION PIPELINE IMPLEMENTATION
// ==========================================
async function runLivePipeline(campaign: any): Promise<void> {
  const campaignId = campaign._id.toString();
  const limit = pLimit(4); // Concurrency limit 4

  // Stage 1: ICP & Search Objectives via Gemini
  logger.info({ campaignId }, "Stage 1: Generating ICP and objectives via Gemini");
  campaign.progress = {
    stage: "icp",
    current: 1,
    total: 5,
    message: "Generating strategic ICP and search objectives via Gemini..."
  };
  eventBus.emitProgress({
    campaignId,
    stage: "icp",
    current: 1,
    total: 5,
    message: "Gemini is analyzing your product offering and market filters..."
  });

  const icpOutput = await GeminiService.generateICP(
    campaign.offering,
    campaign.valueProps || [],
    campaign.filters
  );

  campaign.icp = icpOutput.icp;
  campaign.searchObjectives = icpOutput.searchObjectives;
  campaign.stats.apiCalls.gemini = (campaign.stats.apiCalls.gemini || 0) + 1;
  await campaign.save();

  // Stage 2: Discover Companies via Parallel Entity Search
  logger.info({ campaignId, count: campaign.searchObjectives.length }, "Stage 2: Entity search via Parallel");
  campaign.progress = {
    stage: "discover",
    current: 2,
    total: 5,
    message: `Querying Parallel Entity Search across ${campaign.searchObjectives.length} objectives...`
  };
  eventBus.emitProgress({
    campaignId,
    stage: "discover",
    current: 2,
    total: 5,
    message: "Parallel Entity Search discovering matching companies..."
  });

  const entitySearchPromises = campaign.searchObjectives.map((obj: any, idx: number) =>
    ParallelService.entitySearch(obj.objective, env.ENTITY_MATCH_LIMIT).then((res) => ({
      results: res.entities,
      objectiveIndex: idx
    }))
  );

  const entityResults = await Promise.allSettled(entitySearchPromises);
  campaign.stats.apiCalls.parallelEntity += campaign.searchObjectives.length;

  const discoveredMap = new Map<string, { name: string; website: string; domain: string; description: string; objectiveIndex: number }>();

  for (const settled of entityResults) {
    if (settled.status === "fulfilled") {
      for (const ent of settled.value.results) {
        if (!ent.url) continue;
        const domain = extractDomain(ent.url);
        if (!discoveredMap.has(domain)) {
          discoveredMap.set(domain, {
            name: ent.name || domain,
            website: ent.url,
            domain,
            description: ent.description || "",
            objectiveIndex: settled.value.objectiveIndex
          });
        }
      }
    } else {
      logger.warn({ err: settled.reason }, "One entity search objective failed");
    }
  }

  // Dedupe & cap at MAX_LEADS_PER_CAMPAIGN
  const rawEntities = Array.from(discoveredMap.values()).slice(0, env.MAX_LEADS_PER_CAMPAIGN);
  const createdLeads: ILead[] = [];

  for (const ent of rawEntities) {
    try {
      const lead = await Lead.findOneAndUpdate(
        { campaignId, domain: ent.domain },
        {
          $setOnInsert: {
            campaignId,
            name: ent.name,
            website: ent.website,
            domain: ent.domain,
            description: ent.description,
            sourceObjectiveIndex: ent.objectiveIndex,
            status: "new",
            notes: ""
          }
        },
        { upsert: true, new: true }
      );
      createdLeads.push(lead);
      eventBus.emitLeadAdded({ campaignId, lead });
    } catch (err) {
      logger.warn({ err, domain: ent.domain }, "Could not insert lead (possibly duplicate)");
    }
  }

  campaign.stats.found = createdLeads.length;
  await campaign.save();

  // Stage 3: Enrich each lead via Parallel Search
  logger.info({ campaignId, count: createdLeads.length }, "Stage 3: Enriching leads via Parallel Search");
  campaign.progress = {
    stage: "enrich",
    current: 3,
    total: 5,
    message: `Enriching ${createdLeads.length} leads with live web search evidence (concurrency: 4)...`
  };
  eventBus.emitProgress({
    campaignId,
    stage: "enrich",
    current: 3,
    total: 5,
    message: `Running Parallel Search queries for ${createdLeads.length} companies...`
  });

  const enrichTasks = createdLeads.map((lead) =>
    limit(async () => {
      try {
        // Gemini generates 3 queries + 1 objective for this specific company
        const queryGen = await GeminiService.generateLeadQueries(lead.name, lead.description, campaign.offering);
        campaign.stats.apiCalls.gemini = (campaign.stats.apiCalls.gemini || 0) + 1;

        // Use a per-company unique session ID so Parallel tracks each company separately
        const companySessionId = `${campaign.sessionId || campaignId}-${lead.domain.replace(/\./g, "-")}`;

        // Parallel Search API call — NOT cached, each company gets live unique results
        const searchRes = await ParallelService.enrichCompany(
          queryGen.objective,
          queryGen.search_queries,
          campaign.filters.country,
          companySessionId
        );
        campaign.stats.apiCalls.parallelSearch += 1;

        lead.enrichment = {
          results: searchRes.results.map((r) => ({
            url: r.url,
            title: r.title,
            publishDate: r.publish_date,
            excerpts: r.excerpts || []
          })),
          fetchedAt: new Date(),
          searchId: searchRes.search_id
        };

        await lead.save();
        campaign.stats.enriched += 1;
        logger.info(
          { leadName: lead.name, resultsCount: searchRes.results.length },
          "Lead enrichment completed"
        );
      } catch (err) {
        logger.warn({ err, lead: lead.name }, "Enrichment failed for single lead, continuing");
      }
    })
  );

  await Promise.allSettled(enrichTasks);
  await campaign.save();

  // Stage 4: Score each lead via Gemini
  logger.info({ campaignId, count: createdLeads.length }, "Stage 4: Scoring leads via Gemini");
  campaign.progress = {
    stage: "score",
    current: 4,
    total: 5,
    message: "Scoring leads 0–100 and generating custom outreach emails..."
  };
  eventBus.emitProgress({
    campaignId,
    stage: "score",
    current: 4,
    total: 5,
    message: "Evaluating signals, pitch angles, and writing outreach drafts..."
  });

  let hotCount = 0;
  let warmCount = 0;
  let coldCount = 0;

  const scoreTasks = createdLeads.map((lead) =>
    limit(async () => {
      try {
        const excerpts = (lead.enrichment?.results || []).flatMap((r) => r.excerpts || []);
        const scored = await GeminiService.scoreAndDraft(
          campaign.icp?.summary || campaign.offering,
          lead.name,
          lead.description,
          excerpts,
          campaign.offering
        );
        campaign.stats.apiCalls.gemini = (campaign.stats.apiCalls.gemini || 0) + 1;

        lead.score = scored.score;
        lead.outreach = scored.outreach;

        if (scored.score.tier === "hot") hotCount++;
        else if (scored.score.tier === "warm") warmCount++;
        else coldCount++;

        await lead.save();
        campaign.stats.scored += 1;
        eventBus.emitLeadScored({ campaignId, lead });
      } catch (err) {
        logger.warn({ err, lead: lead.name }, "Scoring failed for single lead, continuing");
      }
    })
  );

  await Promise.allSettled(scoreTasks);

  campaign.stats.hot = hotCount;
  campaign.stats.warm = warmCount;
  campaign.stats.cold = coldCount;

  // Stage 5: Finalise
  campaign.status = "completed";
  campaign.completedAt = new Date();
  campaign.progress = {
    stage: "completed",
    current: 5,
    total: 5,
    message: `Completed! Analyzed ${createdLeads.length} leads (${hotCount} hot, ${warmCount} warm, ${coldCount} cold).`
  };
  await campaign.save();

  eventBus.emitDone({ campaignId, stats: campaign.stats });
  logger.info({ campaignId, stats: campaign.stats }, "Live pipeline completed successfully");
}
