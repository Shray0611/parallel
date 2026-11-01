import pLimit from "p-limit";
import { Campaign, ICampaign } from "../models/Campaign.js";
import { Lead, ILead } from "../models/Lead.js";
import { env } from "../config/env.js";
import { logger } from "../config/logger.js";
import { eventBus } from "./eventBus.js";
import { GeminiService } from "../services/gemini.service.js";
import { ParallelService, FindAllMatch, FindAllMatchCondition } from "../services/parallel.service.js";
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

// ─────────────────────────────────────────────────────────────────────────────
// Utility: Save campaign (DB or memory)
// ─────────────────────────────────────────────────────────────────────────────
async function saveCampaign(campaign: any) {
  if (isDbConnected()) {
    await campaign.save();
  } else {
    inMemoryCampaigns.set(campaign._id?.toString() || campaign.id, campaign);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Utility: Upsert a discovered entity as a Lead
// ─────────────────────────────────────────────────────────────────────────────
async function upsertLead(
  campaignId: string,
  ent: {
    name: string;
    website: string;
    domain: string;
    description: string;
    objectiveIndex: number;
    sourceObjectiveQuery?: string;
    attributes?: Record<string, any>;
  },
  campaignMemStore: any[]
): Promise<any | null> {
  // Format attributes if available from FindAll enrich
  let extraNotes = "";
  if (ent.attributes && Object.keys(ent.attributes).length > 0) {
    extraNotes = Object.entries(ent.attributes)
      .map(([k, v]) => `${k.replace(/_/g, " ")}: ${v}`)
      .join(" | ");
  }

  const leadDocData: any = {
    campaignId,
    name: ent.name,
    website: ent.website,
    domain: ent.domain,
    description: ent.description || "",
    sourceObjectiveIndex: ent.objectiveIndex,
    sourceObjectiveQuery: ent.sourceObjectiveQuery || "",
    findallAttributes: ent.attributes || {},
    status: "new",
    notes: extraNotes
  };

  if (isDbConnected()) {
    try {
      const existing = await Lead.findOne({ campaignId, domain: ent.domain });
      if (existing) return null;
      return await Lead.findOneAndUpdate(
        { campaignId, domain: ent.domain },
        { $setOnInsert: leadDocData },
        { upsert: true, new: true }
      );
    } catch (err) {
      logger.warn({ err, domain: ent.domain }, "Could not upsert lead");
      return null;
    }
  } else {
    const existing = campaignMemStore.find((l) => l.domain === ent.domain);
    if (existing) return null;
    const newLead = { ...leadDocData, _id: `lead-${Date.now()}-${Math.random().toString(36).slice(2)}` };
    campaignMemStore.push(newLead);
    return newLead;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Utility: Full Research & Enrichment Flow (Extract + Search + Task + Score + Monitor)
// ─────────────────────────────────────────────────────────────────────────────
async function enrichAndScoreLead(
  lead: any,
  campaign: any,
  campaignId: string
): Promise<{ hotCount: number; warmCount: number; coldCount: number }> {
  let hotCount = 0, warmCount = 0, coldCount = 0;

  // 1. Parallel Extract API: Pull live structured page summary from company website
  if (lead.website) {
    try {
      const extractRes = await ParallelService.extract(
        [lead.website],
        `Summarize ${lead.name}'s primary products, target enterprise buyers, and technology stack`
      );
      campaign.stats.apiCalls.parallelExtract = (campaign.stats.apiCalls.parallelExtract || 0) + 1;
      const firstResult = extractRes?.results?.[0];
      if (firstResult) {
        lead.extractedSummary =
          firstResult.summary ||
          (firstResult.excerpts || []).join("\n\n").slice(0, 2000) ||
          firstResult.full_content?.slice(0, 2000) ||
          firstResult.content?.slice(0, 2000) ||
          "";
        if (isDbConnected()) {
          await Lead.findByIdAndUpdate(lead._id, { extractedSummary: lead.extractedSummary });
        }
      }
    } catch (err) {
      logger.debug({ err, lead: lead.name }, "Extract API skipped or failed (non-fatal)");
    }
  }

  // 2. Parallel Search API: Live web search for signals & news
  try {
    const queryGen = await GeminiService.generateLeadQueries(
      lead.name,
      lead.description,
      campaign.offering
    );
    if (GeminiService.getLastProvider() === "groq") {
      campaign.stats.apiCalls.groq = (campaign.stats.apiCalls.groq || 0) + 1;
    } else {
      campaign.stats.apiCalls.gemini = (campaign.stats.apiCalls.gemini || 0) + 1;
    }

    const companySessionId = `${campaign.sessionId || campaignId}-${lead.domain?.replace(/\./g, "-")}`;

    const searchRes = await ParallelService.search(
      queryGen.objective,
      queryGen.search_queries,
      campaign.filters?.country || "in",
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

    if (isDbConnected()) {
      await Lead.findByIdAndUpdate(lead._id, { enrichment: lead.enrichment });
    }
    campaign.stats.enriched += 1;
  } catch (err) {
    logger.warn({ err, lead: lead.name }, "Search enrichment failed for lead (continuing)");
  }

  // 3. Parallel Task API: Deep research task on enterprise buying signals
  try {
    const taskRes = await ParallelService.taskRun(
      `Identify key workflow pain points, recent modernization initiatives, and buying signals for ${lead.name} regarding ${campaign.offering}. Company website: ${lead.website || lead.domain}.`,
      lead.website ? [lead.website] : []
    );
    campaign.stats.apiCalls.parallelTask = (campaign.stats.apiCalls.parallelTask || 0) + 1;
    if (taskRes?.output) {
      lead.taskResearch = taskRes.output;
      lead.taskRunId = taskRes.id;
      if (isDbConnected()) {
        await Lead.findByIdAndUpdate(lead._id, {
          taskResearch: lead.taskResearch,
          taskRunId: lead.taskRunId
        });
      }
    }
  } catch (err) {
    logger.debug({ err, lead: lead.name }, "Task API research skipped or failed (non-fatal)");
  }

  // 4. AI Scoring & Outreach (Groq / Gemini)
  try {
    const searchExcerpts = (lead.enrichment?.results || []).flatMap((r: any) => r.excerpts || []);
    const combinedContext = [
      ...searchExcerpts,
      lead.extractedSummary ? `Website Extract: ${lead.extractedSummary}` : "",
      lead.taskResearch ? `Research Task Findings: ${lead.taskResearch}` : ""
    ].filter(Boolean);

    const scored = await GeminiService.scoreAndDraft(
      campaign.icp?.summary || campaign.offering,
      lead.name,
      lead.description,
      combinedContext,
      campaign.offering
    );
    if (GeminiService.getLastProvider() === "groq") {
      campaign.stats.apiCalls.groq = (campaign.stats.apiCalls.groq || 0) + 1;
    } else {
      campaign.stats.apiCalls.gemini = (campaign.stats.apiCalls.gemini || 0) + 1;
    }

    lead.score = scored.score;
    lead.outreach = scored.outreach;

    if (scored.score.tier === "hot") {
      hotCount++;
      // 5. Parallel Monitor API: Track hot lead over time for funding/hiring news
      try {
        const monitorRes = await ParallelService.createMonitor(
          `Material changes, leadership hiring, funding, and expansion news for ${lead.name} (${lead.domain})`,
          "weekly"
        );
        campaign.stats.apiCalls.parallelMonitor = (campaign.stats.apiCalls.parallelMonitor || 0) + 1;
        if (monitorRes?.id || monitorRes?.monitor_id) {
          lead.monitorId = monitorRes.id || monitorRes.monitor_id;
        }
      } catch (err) {
        logger.debug({ err, lead: lead.name }, "Monitor registration skipped (non-fatal)");
      }
    } else if (scored.score.tier === "warm") {
      warmCount++;
    } else {
      coldCount++;
    }

    if (isDbConnected()) {
      await Lead.findByIdAndUpdate(lead._id, {
        score: lead.score,
        outreach: lead.outreach,
        monitorId: lead.monitorId
      });
    }

    campaign.stats.scored += 1;
    eventBus.emitLeadScored({ campaignId, lead });
  } catch (err) {
    logger.warn({ err, lead: lead.name }, "Scoring failed for lead (continuing)");
  }

  return { hotCount, warmCount, coldCount };
}

function mergeMatches(primary: FindAllMatch[], secondary: FindAllMatch[]): FindAllMatch[] {
  const merged = new Map<string, FindAllMatch>();
  const keyFor = (match: FindAllMatch) => {
    const url = match.url || match.name || "";
    try {
      return extractDomain(url);
    } catch {
      return url.toLowerCase();
    }
  };

  for (const match of secondary) {
    const key = keyFor(match);
    if (key) merged.set(key, match);
  }
  for (const match of primary) {
    const key = keyFor(match);
    if (!key) continue;
    const existing = merged.get(key);
    merged.set(key, {
      ...existing,
      ...match,
      attributes: { ...(existing?.attributes || {}), ...(match.attributes || {}) }
    });
  }
  return Array.from(merged.values());
}

// ─────────────────────────────────────────────────────────────────────────────
// Discover leads: Entity Search first (seconds), then FindAll for precision
// ─────────────────────────────────────────────────────────────────────────────
async function discoverLeadsForObjective(
  objective: string,
  objectiveIndex: number,
  campaign: any,
  matchLimit: number = 10,
  existingRunId?: string,
  onBatch?: (matches: FindAllMatch[], source: "entity" | "findall") => Promise<void> | void
): Promise<{ matches: FindAllMatch[]; runId: string }> {
  const matchConditions: FindAllMatchCondition[] = [
    {
      name: "target_market_match",
      description: `Company must be an active, verified organization matching: ${objective}`
    }
  ];

  if (campaign.filters?.country) {
    matchConditions.push({
      name: "geographic_location_check",
      description: `Company must operate in or serve customers in ${campaign.filters.country}.`
    });
  }

  if (campaign.filters?.companySize) {
    matchConditions.push({
      name: "company_size_check",
      description: `Company should have approximate headcount of ${campaign.filters.companySize} employees.`
    });
  }

  let entityMatches: FindAllMatch[] = [];

  // 1. Fast Entity Search — real-time first wave
  if (!existingRunId) {
    try {
      const res = await ParallelService.entitySearch(objective, matchLimit);
      campaign.stats.apiCalls.parallelEntity = (campaign.stats.apiCalls.parallelEntity || 0) + 1;
      entityMatches = res.entities.map((e) => ({
        name: e.name,
        url: e.url,
        description: e.description
      }));
      if (entityMatches.length > 0 && onBatch) {
        await onBatch(entityMatches, "entity");
      }
      logger.info({ objectiveIndex, matchCount: entityMatches.length }, "Entity Search first wave complete");
    } catch (entityErr) {
      logger.warn({ err: entityErr, objectiveIndex }, "Fast Entity Search failed — continuing with FindAll");
    }
  }

  // 2. FindAll full run (ingest -> create -> poll -> enrich) or extend
  try {
    logger.info({ objectiveIndex, objective: objective.slice(0, 80), existingRunId }, "Executing Parallel FindAll API discovery");

    let runId = existingRunId || "";
    let findAllMatches: FindAllMatch[] = [];

    if (existingRunId) {
      await ParallelService.findAllExtend(existingRunId, matchLimit);
      campaign.stats.apiCalls.parallelFindAll = (campaign.stats.apiCalls.parallelFindAll || 0) + 1;
      const extended = await ParallelService.findAllPollResults(existingRunId, 120_000);
      findAllMatches = extended.matches || [];
      runId = existingRunId;
    } else {
      const result = await ParallelService.findAllDiscover(objective, matchConditions, matchLimit, true);
      campaign.stats.apiCalls.parallelFindAll = (campaign.stats.apiCalls.parallelFindAll || 0) + 1;
      findAllMatches = result.matches;
      runId = result.runId;
    }

    if (findAllMatches.length > 0 && onBatch) {
      await onBatch(findAllMatches, "findall");
    }

    const matches = mergeMatches(findAllMatches, entityMatches);
    logger.info({ objectiveIndex, matchCount: matches.length, runId }, "FindAll API discovery complete");
    return { matches, runId };
  } catch (findAllErr) {
    logger.warn(
      { err: findAllErr, objectiveIndex, entityMatchCount: entityMatches.length },
      "FindAll run failed or timed out — using Entity Search results"
    );
    return { matches: entityMatches, runId: existingRunId || "" };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Main campaign runner
// ─────────────────────────────────────────────────────────────────────────────
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

  campaign.status = "running";
  campaign.progress = {
    stage: "icp",
    current: 1,
    total: 5,
    message: "Initializing AI discovery pipeline..."
  };
  await saveCampaign(campaign);

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
    await saveCampaign(campaign);
    eventBus.emitError({ campaignId, message: err.message || "Pipeline execution failed" });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// DEMO PIPELINE — realistic fixtures for sandbox testing
// ─────────────────────────────────────────────────────────────────────────────
async function runDemoPipeline(campaign: any): Promise<void> {
  const campaignId = campaign._id ? campaign._id.toString() : campaign.id;
  logger.info({ campaignId }, "Running pipeline in DEMO_MODE with fixture data");

  // Stage 1: ICP
  await sleep(400);
  campaign.icp = {
    summary: `Enterprise companies in ${campaign.filters?.country || "India"} with complex operational workflows that can be automated using ${campaign.offering}.`,
    painPoints: [
      "Manual multi-day document review cycles slowing operational turnaround",
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
      objective: `Enterprise companies in ${campaign.filters?.country || "India"} (${campaign.filters?.companySize || "201-1000"} employees) needing document automation for ${campaign.offering}`,
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
    message: "Discovering enterprise leads via FindAll API..."
  };
  eventBus.emitProgress({
    campaignId,
    stage: "discover",
    current: 2,
    total: 5,
    message: "Discovered 3 targeted search objectives. Executing FindAll runs..."
  });

  await sleep(400);
  const leadsToLoad = fixturesData.slice(0, env.MAX_LEADS_PER_CAMPAIGN || 25);
  const createdLeads: any[] = [];
  const memStore: any[] = [];

  for (let i = 0; i < leadsToLoad.length; i++) {
    const item = leadsToLoad[i];
    const domain = extractDomain(item.website || item.domain || item.name);
    const objIdx = i % 3;

    const lead = await upsertLead(
      campaignId,
      {
        name: item.name,
        website: item.website || `https://${domain}`,
        domain,
        description: item.description || "",
        objectiveIndex: objIdx,
        sourceObjectiveQuery: campaign.searchObjectives[objIdx]?.objective || ""
      },
      memStore
    );

    if (lead) {
      createdLeads.push(lead);
      eventBus.emitLeadAdded({ campaignId, lead });
    }
  }

  if (!isDbConnected()) {
    inMemoryLeads.set(campaignId, memStore);
  }

  campaign.stats.found = createdLeads.length;
  campaign.stats.apiCalls.parallelEntity = 3;

  // Stage 3: Enrich with Extract & Search
  campaign.progress = {
    stage: "enrich",
    current: 3,
    total: 5,
    message: `Enriching ${createdLeads.length} companies with Extract + Search APIs...`
  };
  eventBus.emitProgress({
    campaignId,
    stage: "enrich",
    current: 3,
    total: 5,
    message: `Extracting site structures & running Parallel Search queries for ${createdLeads.length} companies...`
  });

  await sleep(400);
  for (let i = 0; i < createdLeads.length; i++) {
    const item = leadsToLoad[i];
    const lead = createdLeads[i];

    lead.extractedSummary = `${lead.name} operates enterprise software and technology solutions. Primary buyers include heads of IT, compliance, and enterprise workflows.`;
    lead.taskResearch = `High operational complexity with document-intensive processes. Strong candidate for ${campaign.offering}.`;

    lead.enrichment = item.enrichment || {
      results: [
        {
          url: lead.website,
          title: `${lead.name} Enterprise Overview`,
          publishDate: "2026-01-01",
          excerpts: ["Active enterprise operations with ongoing modernization initiatives."]
        }
      ],
      fetchedAt: new Date(),
      searchId: `demo-search-${i}`
    };

    if (isDbConnected()) {
      await Lead.findByIdAndUpdate(lead._id, {
        enrichment: lead.enrichment,
        extractedSummary: lead.extractedSummary,
        taskResearch: lead.taskResearch
      });
    }
  }

  campaign.stats.enriched = createdLeads.length;
  campaign.stats.apiCalls.parallelSearch = createdLeads.length;

  // Stage 4: Score
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

  let hotCount = 0, warmCount = 0, coldCount = 0;
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

    if (score.tier === "hot") {
      hotCount++;
      lead.monitorId = `monitor-demo-${i}`;
    } else if (score.tier === "warm") {
      warmCount++;
    } else {
      coldCount++;
    }

    lead.score = score;
    lead.outreach = outreach;

    if (isDbConnected()) {
      await Lead.findByIdAndUpdate(lead._id, {
        score,
        outreach,
        monitorId: lead.monitorId
      });
    }

    eventBus.emitLeadScored({ campaignId, lead });
    await sleep(80);
  }

  campaign.stats.scored = createdLeads.length;
  campaign.stats.hot = hotCount;
  campaign.stats.warm = warmCount;
  campaign.stats.cold = coldCount;
  campaign.stats.apiCalls.gemini = createdLeads.length + 1;
  campaign.stats.apiCalls.groq = createdLeads.length + 1;

  // Stage 5: Done
  campaign.status = "completed";
  campaign.completedAt = new Date();
  campaign.progress = {
    stage: "completed",
    current: 5,
    total: 5,
    message: `Completed! Scored ${createdLeads.length} leads (${hotCount} hot, ${warmCount} warm, ${coldCount} cold).`
  };
  await saveCampaign(campaign);

  eventBus.emitDone({ campaignId, stats: campaign.stats });
  logger.info({ campaignId, stats: campaign.stats }, "Demo pipeline completed");
}

// ─────────────────────────────────────────────────────────────────────────────
// LIVE PRODUCTION PIPELINE — Full Parallel API Suite
// ─────────────────────────────────────────────────────────────────────────────
async function runLivePipeline(campaign: any): Promise<void> {
  const campaignId = campaign._id.toString();
  const limit = pLimit(3);

  // ── Stage 1: ICP & Search Objectives ──────────────────────────────────────
  logger.info({ campaignId }, "Stage 1: Generating ICP and objectives via AI");
  campaign.progress = {
    stage: "icp",
    current: 1,
    total: 5,
    message: "Generating strategic ICP and search objectives..."
  };
  eventBus.emitProgress({
    campaignId,
    stage: "icp",
    current: 1,
    total: 5,
    message: "AI engine is analyzing your product offering and market filters..."
  });

  const icpOutput = await GeminiService.generateICP(
    campaign.offering,
    campaign.valueProps || [],
    campaign.filters
  );

  campaign.icp = icpOutput.icp;
  campaign.searchObjectives = icpOutput.searchObjectives;
  if (GeminiService.getLastProvider() === "groq") {
    campaign.stats.apiCalls.groq = (campaign.stats.apiCalls.groq || 0) + 1;
  } else {
    campaign.stats.apiCalls.gemini = (campaign.stats.apiCalls.gemini || 0) + 1;
  }
  await saveCampaign(campaign);

  // ── Stage 2: Discover via FindAll API ─────────────────────────────────────
  logger.info(
    { campaignId, count: campaign.searchObjectives.length },
    "Stage 2: Real-time lead discovery via Parallel FindAll API"
  );
  campaign.progress = {
    stage: "discover",
    current: 2,
    total: 5,
    message: `Discovering companies via Parallel FindAll across ${campaign.searchObjectives.length} objectives...`
  };
  eventBus.emitProgress({
    campaignId,
    stage: "discover",
    current: 2,
    total: 5,
    message: "FindAll API discovering and enriching matching companies in real-time..."
  });

  const discoveredMap = new Map<string, {
    name: string;
    website: string;
    domain: string;
    description: string;
    objectiveIndex: number;
    sourceObjectiveQuery: string;
    attributes?: Record<string, any>;
  }>();

  const findallRunIds: string[] = new Array(campaign.searchObjectives.length).fill("");
  const createdLeads: any[] = [];
  const memStore: any[] = [];

  const persistMatches = async (matches: FindAllMatch[], idx: number, sourceObjectiveQuery: string) => {
    for (const match of matches) {
      if (createdLeads.length >= env.MAX_LEADS_PER_CAMPAIGN) break;
      if (!match.url && !match.name) continue;
      const url = match.url || `https://${match.name?.toLowerCase().replace(/\s+/g, "")}.com`;
      const domain = extractDomain(url);
      if (!domain || domain.length < 3) continue;

      const existing = discoveredMap.get(domain);
      if (existing) {
        if (match.attributes && Object.keys(match.attributes).length > 0) {
          existing.attributes = { ...(existing.attributes || {}), ...match.attributes };
          if (match.description) existing.description = match.description;
          const already = createdLeads.find((l) => l.domain === domain);
          if (already) {
            already.findallAttributes = existing.attributes;
            already.description = existing.description || already.description;
            already.notes = Object.entries(existing.attributes)
              .map(([k, v]) => `${k.replace(/_/g, " ")}: ${v}`)
              .join(" | ");
            if (isDbConnected()) {
              await Lead.findByIdAndUpdate(already._id, {
                findallAttributes: already.findallAttributes,
                description: already.description,
                notes: already.notes
              });
            }
            eventBus.emitLeadAdded({ campaignId, lead: already });
          }
        }
        continue;
      }

      const ent = {
        name: match.name || domain,
        website: url,
        domain,
        description: match.description || "",
        objectiveIndex: idx,
        sourceObjectiveQuery,
        attributes: match.attributes
      };
      discoveredMap.set(domain, ent);

      const lead = await upsertLead(campaignId, ent, memStore);
      if (lead) {
        createdLeads.push(lead);
        campaign.stats.found = createdLeads.length;
        eventBus.emitLeadAdded({ campaignId, lead });
      }
    }
  };

  const discoveryTasks = campaign.searchObjectives.map((obj: any, idx: number) =>
    limit(async () => {
      eventBus.emitProgress({
        campaignId,
        stage: "discover",
        current: 2,
        total: 5,
        message: `[${idx + 1}/${campaign.searchObjectives.length}] Finding companies: ${obj.objective.slice(0, 80)}...`
      });

      const { matches, runId } = await discoverLeadsForObjective(
        obj.objective,
        idx,
        campaign,
        Math.max(5, Math.ceil(env.ENTITY_MATCH_LIMIT / campaign.searchObjectives.length) + 5),
        undefined,
        async (batch) => {
          await persistMatches(batch, idx, obj.objective);
          eventBus.emitProgress({
            campaignId,
            stage: "discover",
            current: 2,
            total: 5,
            message: `Live leads arriving — ${createdLeads.length} companies found so far...`
          });
        }
      );

      if (runId) findallRunIds[idx] = runId;
      await persistMatches(matches, idx, obj.objective);
      logger.info({ objectiveIndex: idx, matchCount: matches.length }, "Objective discovery complete");
    })
  );

  await Promise.allSettled(discoveryTasks);

  campaign.findallRunIds = findallRunIds;

  if (!isDbConnected()) {
    inMemoryLeads.set(campaignId, memStore);
  }

  campaign.stats.found = createdLeads.length;
  await saveCampaign(campaign);

  logger.info({ campaignId, totalFound: createdLeads.length }, "Stage 2 discovery complete");

  // ── Stage 3 + 4: Extract + Search + Task + Score concurrently per lead ────
  logger.info({ campaignId, count: createdLeads.length }, "Stage 3+4: Enriching and scoring leads with Extract + Search + Task APIs");
  campaign.progress = {
    stage: "enrich",
    current: 3,
    total: 5,
    message: `Enriching ${createdLeads.length} leads with Extract, Search & Task intelligence (concurrency: 3)...`
  };
  eventBus.emitProgress({
    campaignId,
    stage: "enrich",
    current: 3,
    total: 5,
    message: `Running Parallel Extract, Web Search & Task research for ${createdLeads.length} companies...`
  });

  let totalHot = 0, totalWarm = 0, totalCold = 0;

  const enrichScoreTasks = createdLeads.map((lead) =>
    limit(async () => {
      const counts = await enrichAndScoreLead(lead, campaign, campaignId);
      totalHot += counts.hotCount;
      totalWarm += counts.warmCount;
      totalCold += counts.coldCount;
    })
  );

  await Promise.allSettled(enrichScoreTasks);

  campaign.stats.hot = totalHot;
  campaign.stats.warm = totalWarm;
  campaign.stats.cold = totalCold;

  // ── Stage 5: Finalize ─────────────────────────────────────────────────────
  campaign.progress = {
    stage: "score",
    current: 4,
    total: 5,
    message: `Scored ${createdLeads.length} leads, finalizing...`
  };
  eventBus.emitProgress({
    campaignId,
    stage: "score",
    current: 4,
    total: 5,
    message: "Evaluating signals, pitch angles, and writing outreach drafts..."
  });

  campaign.status = "completed";
  campaign.completedAt = new Date();
  campaign.progress = {
    stage: "completed",
    current: 5,
    total: 5,
    message: `Completed! Analyzed ${createdLeads.length} leads (${totalHot} hot, ${totalWarm} warm, ${totalCold} cold).`
  };
  await saveCampaign(campaign);

  eventBus.emitDone({ campaignId, stats: campaign.stats });
  logger.info({ campaignId, stats: campaign.stats }, "Live pipeline completed successfully");
}

// ─────────────────────────────────────────────────────────────────────────────
// Find More Leads for a specific objective index
// ─────────────────────────────────────────────────────────────────────────────
export async function findMoreLeads(campaignId: string, objectiveIndex: number): Promise<number> {
  let campaign: any = null;
  if (isDbConnected()) {
    campaign = await Campaign.findById(campaignId);
  } else {
    campaign = inMemoryCampaigns.get(campaignId);
  }

  if (!campaign || !campaign.searchObjectives?.[objectiveIndex]) {
    throw new Error("Campaign or objective not found");
  }

  const obj = campaign.searchObjectives[objectiveIndex];
  const existingRunId = campaign.findallRunIds?.[objectiveIndex] || "";

  logger.info(
    { campaignId, objectiveIndex, objective: obj.objective.slice(0, 80), existingRunId },
    "Finding more leads for objective"
  );

  const memStore: any[] = isDbConnected() ? [] : (inMemoryLeads.get(campaignId) || []);
  let newLeadsCount = 0;
  const seenDomains = new Set<string>();

  const persistFound = async (batch: FindAllMatch[]) => {
    for (const match of batch) {
      if (!match.url && !match.name) continue;
      const url = match.url || `https://${match.name?.toLowerCase().replace(/\s+/g, "")}.com`;
      const domain = extractDomain(url);
      if (!domain || domain.length < 3 || seenDomains.has(domain)) continue;
      seenDomains.add(domain);

      const lead = await upsertLead(
        campaignId,
        {
          name: match.name || domain,
          website: url,
          domain,
          description: match.description || "",
          objectiveIndex,
          sourceObjectiveQuery: obj.objective,
          attributes: match.attributes
        },
        memStore
      );

      if (lead) {
        newLeadsCount++;
        eventBus.emitLeadAdded({ campaignId, lead });
        pLimit(1)(async () => {
          await enrichAndScoreLead(lead, campaign, campaignId);
        }).catch((err) => logger.warn({ err }, "Background enrich/score failed for find-more lead"));
      }
    }
  };

  const { matches, runId } = await discoverLeadsForObjective(
    obj.objective,
    objectiveIndex,
    campaign,
    10,
    existingRunId || undefined,
    persistFound
  );

  if (runId && runId !== existingRunId) {
    if (!campaign.findallRunIds) campaign.findallRunIds = [];
    campaign.findallRunIds[objectiveIndex] = runId;
    await saveCampaign(campaign);
  }

  await persistFound(matches);

  if (!isDbConnected()) {
    inMemoryLeads.set(campaignId, memStore);
  }

  campaign.stats.found = (campaign.stats.found || 0) + newLeadsCount;
  await saveCampaign(campaign);
  eventBus.emitDone({ campaignId, stats: campaign.stats });

  logger.info({ campaignId, objectiveIndex, newLeadsCount }, "Find more leads complete");
  return newLeadsCount;
}

// ─────────────────────────────────────────────────────────────────────────────
// Re-run objective fresh
// ─────────────────────────────────────────────────────────────────────────────
export async function rerunObjective(campaignId: string, objectiveIndex: number): Promise<number> {
  let campaign: any = null;
  if (isDbConnected()) {
    campaign = await Campaign.findById(campaignId);
  } else {
    campaign = inMemoryCampaigns.get(campaignId);
  }

  if (!campaign || !campaign.searchObjectives?.[objectiveIndex]) {
    throw new Error("Campaign or objective not found");
  }

  const obj = campaign.searchObjectives[objectiveIndex];

  // Clear existing run ID to force a fresh FindAll run
  if (campaign.findallRunIds) {
    campaign.findallRunIds[objectiveIndex] = "";
    await saveCampaign(campaign);
  }

  logger.info(
    { campaignId, objectiveIndex, objective: obj.objective.slice(0, 80) },
    "Re-running objective with fresh FindAll run"
  );

  return findMoreLeads(campaignId, objectiveIndex);
}
