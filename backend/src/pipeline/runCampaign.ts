import pLimit from "p-limit";
import { Campaign, ICampaign } from "../models/Campaign.js";
import { Lead, ILead } from "../models/Lead.js";
import { env } from "../config/env.js";
import { logger } from "../config/logger.js";
import { eventBus } from "./eventBus.js";
import { GeminiService } from "../services/gemini.service.js";
import { placeLabel } from "../utils/location.js";
import { isRateLimitError } from "../utils/errors.js";
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
const LEADS_PER_QUERY = 3;

function usableMatches(matches: FindAllMatch[], limit: number): FindAllMatch[] {
  const seen = new Set<string>();
  const kept: FindAllMatch[] = [];
  for (const match of matches) {
    const identity = companyIdentity(match.name, match.url);
    if (!identity || seen.has(identity.domain)) continue;
    seen.add(identity.domain);
    kept.push(match);
    if (kept.length >= limit) break;
  }
  return kept;
}

const activeCampaignJobs = new Set<string>();

export function campaignJobBusy(campaignId: string): boolean {
  return activeCampaignJobs.has(campaignId);
}

export function beginCampaignJob(campaignId: string): boolean {
  if (activeCampaignJobs.has(campaignId)) return false;
  activeCampaignJobs.add(campaignId);
  return true;
}

export function endCampaignJob(campaignId: string): void {
  activeCampaignJobs.delete(campaignId);
}

export function extractDomain(urlStr: string): string {
  try {
    const parsed = new URL(urlStr.startsWith("http") ? urlStr : `https://${urlStr}`);
    return parsed.hostname.replace(/^www\./i, "").toLowerCase();
  } catch {
    return urlStr.replace(/^(?:https?:\/\/)?(?:www\.)?/i, "").split("/")[0].toLowerCase();
  }
}

const SHARED_PROFILE_HOSTS = [
  "linkedin.com", "crunchbase.com", "wikipedia.org", "bloomberg.com", "zoominfo.com",
  "pitchbook.com", "tracxn.com", "google.com", "facebook.com", "instagram.com",
  "youtube.com", "x.com", "twitter.com", "glassdoor.com", "indeed.com", "ambitionbox.com",
  "zaubacorp.com", "tofler.in", "indiamart.com", "justdial.com", "owler.com", "craft.co",
  "cbinsights.com", "g2.com", "capterra.com", "clutch.co", "economictimes.com",
  "indiatimes.com", "moneycontrol.com", "business-standard.com", "livemint.com",
  "yourstory.com", "inc42.com", "techcrunch.com", "reuters.com", "forbes.com"
];

function isSharedProfileHost(hostname: string): boolean {
  const host = hostname.replace(/^www\./i, "").toLowerCase();
  return SHARED_PROFILE_HOSTS.some((shared) => host === shared || host.endsWith(`.${shared}`));
}

function slugifyCompanyName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
}

export function companyIdentity(name: string, url?: string): { website: string; domain: string } | null {
  const cleanName = (name || "").trim();
  const rawUrl = (url || "").trim();
  if (!rawUrl) return null;

  const website = /^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`;
  const host = extractDomain(website);
  if (!host || host.length < 3 || host.includes(" ")) return null;

  if (isSharedProfileHost(host)) {
    const slug = slugifyCompanyName(cleanName);
    if (slug.length < 2) return null;
    return { website, domain: `${host}/${slug}` };
  }

  return { website, domain: host };
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
// Utility: Research and score a lead (Search + Task + score + Monitor)
// ─────────────────────────────────────────────────────────────────────────────
async function enrichAndScoreLead(
  lead: any,
  campaign: any,
  campaignId: string
): Promise<{ hotCount: number; warmCount: number; coldCount: number }> {
  let hotCount = 0, warmCount = 0, coldCount = 0;
  const objectiveLocation = campaign.searchObjectives?.[lead.sourceObjectiveIndex];
  const searchCountry = (objectiveLocation?.country || campaign.filters?.country || "in").toLowerCase();

  if (lead.score?.total != null && lead.enrichment?.results?.length) {
    if (lead.score.tier === "hot") hotCount++;
    else if (lead.score.tier === "warm") warmCount++;
    else coldCount++;
    return { hotCount, warmCount, coldCount };
  }

  // Parallel Search API: live pages for buying signals. Company sites are not scraped.
  if (!lead.enrichment?.results?.length) try {
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
      searchCountry,
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
    if (isRateLimitError(err)) throw err;
    logger.warn({ err, lead: lead.name }, "Search enrichment failed for lead (continuing)");
  }

  // 3. Parallel Task API: Deep research task on enterprise buying signals
  if (!lead.taskResearch) try {
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
    if (isRateLimitError(err)) throw err;
    logger.debug({ err, lead: lead.name }, "Task API research skipped or failed (non-fatal)");
  }

  if (lead.score?.total != null) {
    if (lead.score.tier === "hot") hotCount++;
    else if (lead.score.tier === "warm") warmCount++;
    else coldCount++;
    return { hotCount, warmCount, coldCount };
  }

  // 4. AI Scoring & Outreach (Groq / Gemini)
  try {
    const searchExcerpts = (lead.enrichment?.results || []).flatMap((r: any) => r.excerpts || []);
    const combinedContext = [
      ...searchExcerpts,
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
        if (isRateLimitError(err)) throw err;
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
    if (isRateLimitError(err)) throw err;
    logger.warn({ err, lead: lead.name }, "Scoring failed for lead (continuing)");
  }

  return { hotCount, warmCount, coldCount };
}

function mergeMatches(primary: FindAllMatch[], secondary: FindAllMatch[]): FindAllMatch[] {
  const merged = new Map<string, FindAllMatch>();
  const keyFor = (match: FindAllMatch) => companyIdentity(match.name, match.url)?.domain || "";

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
  onBatch?: (matches: FindAllMatch[], source: "entity" | "findall") => Promise<void> | void,
  queries: string[] = [],
  maxWaitMs: number = 75_000,
  location?: { country?: string; city?: string; companySize?: string },
  excludeNames: string[] = []
): Promise<{ matches: FindAllMatch[]; runId: string }> {
  const country = location?.country || campaign.filters?.country || "";
  const city = location?.city || "";
  const companySize = location?.companySize || campaign.filters?.companySize || "";
  const place = placeLabel(country, city);
  const locatedObjective = [
    objective,
    place ? `Companies must be based in ${place}.` : "",
    companySize ? `Target company size is ${companySize} employees.` : ""
  ].filter(Boolean).join(" ");
  const focus = queries.filter(Boolean).slice(0, 4);
  const matchConditions: FindAllMatchCondition[] = [
    {
      name: "company_matches_objective",
      description: focus.length
        ? `${locatedObjective} Relevant signals include: ${focus.join("; ")}.`
        : locatedObjective
    }
  ];

  const excluded = excludeNames.map((name) => name.trim()).filter(Boolean).slice(0, 30);
  const entityObjective = excluded.length
    ? `${locatedObjective} Find additional companies. Do not return: ${excluded.join(", ")}.`
    : locatedObjective;

  let entityMatches: FindAllMatch[] = [];

  // 1. Fast Entity Search. The API minimum is 5, then we keep matchLimit companies.
  try {
    const res = await ParallelService.entitySearch(entityObjective, Math.max(5, matchLimit), {
      fresh: Boolean(existingRunId) || excluded.length > 0
    });
    campaign.stats.apiCalls.parallelEntity = (campaign.stats.apiCalls.parallelEntity || 0) + 1;
    entityMatches = usableMatches(
      res.entities.map((e) => ({
        name: e.name,
        url: e.url,
        description: e.description
      })),
      matchLimit
    );
    if (entityMatches.length > 0 && onBatch) {
      await onBatch(entityMatches, "entity");
    }
    logger.info({ objectiveIndex, matchCount: entityMatches.length, fresh: Boolean(existingRunId) }, "Entity Search first wave complete");
  } catch (entityErr) {
    logger.warn({ err: entityErr, objectiveIndex }, "Fast Entity Search failed — continuing with FindAll");
  }

  if (entityMatches.length >= matchLimit) {
    logger.info({ objectiveIndex, matchCount: entityMatches.length }, "Query filled from Entity Search");
    return { matches: entityMatches, runId: existingRunId || "" };
  }

  // 2. FindAll only when Entity Search did not fill the query. No enrich pass.
  const findAllWait = Math.min(maxWaitMs, 40_000);
  try {
    logger.info({ objectiveIndex, objective: objective.slice(0, 80), existingRunId, findAllWait }, "Executing Parallel FindAll API discovery");

    let runId = existingRunId || "";
    let findAllMatches: FindAllMatch[] = [];

    if (existingRunId) {
      try {
        await ParallelService.findAllExtend(existingRunId, matchLimit);
        campaign.stats.apiCalls.parallelFindAll = (campaign.stats.apiCalls.parallelFindAll || 0) + 1;
      } catch (extendErr) {
        logger.warn({ err: extendErr, objectiveIndex, existingRunId }, "FindAll extend failed — keeping the current run");
      }
      const extended = await ParallelService.findAllPollResults(existingRunId, findAllWait);
      findAllMatches = extended.matches || [];
      runId = existingRunId;
    } else {
      const result = await ParallelService.findAllDiscover(locatedObjective, matchConditions, Math.max(5, matchLimit), false, findAllWait);
      campaign.stats.apiCalls.parallelFindAll = (campaign.stats.apiCalls.parallelFindAll || 0) + 1;
      findAllMatches = result.matches;
      runId = result.runId;
    }

    if (findAllMatches.length > 0 && onBatch) {
      await onBatch(findAllMatches, "findall");
    }

    const matches = usableMatches(mergeMatches(findAllMatches, entityMatches), matchLimit);
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
    campaign.progress.message = isRateLimitError(err)
      ? "Rate limit reached. Saved companies stay in the list. Use Continue when the limit clears."
      : (err.message || "Pipeline execution failed");
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

  // Stage 3: Enrich with Search
  campaign.progress = {
    stage: "enrich",
    current: 3,
    total: 5,
    message: `Researching ${createdLeads.length} companies with live search...`
  };
  eventBus.emitProgress({
    campaignId,
    stage: "enrich",
    current: 3,
    total: 5,
    message: `Running live search for buying signals on ${createdLeads.length} companies...`
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
  const enrichLimit = pLimit(1);

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

  const reviewedObjectives = (campaign.searchObjectives || []).filter((item: any) => item?.objective?.trim());
  const hasIcp = Boolean(campaign.icp?.summary);

  if (reviewedObjectives.length > 0 && hasIcp) {
    campaign.searchObjectives = reviewedObjectives;
    campaign.progress.message = "Using the search objectives you reviewed before launch...";
    eventBus.emitProgress({
      campaignId,
      stage: "icp",
      current: 1,
      total: 5,
      message: `Using ${reviewedObjectives.length} reviewed search objectives. Nothing was regenerated.`
    });
  } else {
    const icpOutput = await GeminiService.generateICP(
      campaign.offering,
      campaign.valueProps || [],
      campaign.filters
    );
    if (!hasIcp) campaign.icp = icpOutput.icp;
    if (reviewedObjectives.length === 0) campaign.searchObjectives = icpOutput.searchObjectives;
    if (GeminiService.getLastProvider() === "groq") {
      campaign.stats.apiCalls.groq = (campaign.stats.apiCalls.groq || 0) + 1;
    } else {
      campaign.stats.apiCalls.gemini = (campaign.stats.apiCalls.gemini || 0) + 1;
    }
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

  const perQueryCap = LEADS_PER_QUERY;

  const existingLeads = isDbConnected()
    ? await Lead.find({ campaignId })
    : (inMemoryLeads.get(campaignId) || []);
  for (const lead of existingLeads) {
    createdLeads.push(lead);
    if (lead.domain) {
      discoveredMap.set(lead.domain, {
        name: lead.name,
        website: lead.website,
        domain: lead.domain,
        description: lead.description || "",
        objectiveIndex: lead.sourceObjectiveIndex || 0,
        sourceObjectiveQuery: lead.sourceObjectiveQuery || ""
      });
    }
  }
  if (Array.isArray(campaign.findallRunIds)) {
    campaign.findallRunIds.forEach((runId: string, index: number) => {
      if (runId) findallRunIds[index] = runId;
    });
  }

  const persistMatches = async (matches: FindAllMatch[], idx: number, sourceObjectiveQuery: string) => {
    for (const match of matches) {
      const owned = createdLeads.filter((lead) => lead.sourceObjectiveIndex === idx).length;
      if (owned >= perQueryCap || createdLeads.length >= env.MAX_LEADS_PER_CAMPAIGN) break;
      const identity = companyIdentity(match.name, match.url);
      if (!identity) continue;
      const { website, domain } = identity;

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
        website,
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

  for (let idx = 0; idx < campaign.searchObjectives.length; idx++) {
    const obj = campaign.searchObjectives[idx];
    try {
      const already = createdLeads.filter((lead) => lead.sourceObjectiveIndex === idx);
      if (already.length >= perQueryCap) {
        logger.info({ objectiveIndex: idx, saved: already.length }, "Query already has its companies");
        eventBus.emitProgress({
          campaignId,
          stage: "discover",
          current: 2,
          total: 5,
          message: `Query ${idx + 1} already has ${already.length} companies. Scoring is next.`,
          objectiveIndex: idx,
          objective: obj.objective
        });
        continue;
      }

      eventBus.emitProgress({
        campaignId,
        stage: "discover",
        current: 2,
        total: 5,
        message: `Finding companies for query ${idx + 1}: ${obj.objective}`,
        objectiveIndex: idx,
        objective: obj.objective
      });

      const { matches, runId } = await discoverLeadsForObjective(
        obj.objective,
        idx,
        campaign,
        perQueryCap - already.length,
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
        },
        obj.queries || [],
        75_000,
        {
          country: obj.country || campaign.filters?.country,
          city: obj.city || campaign.filters?.city || "",
          companySize: obj.companySize || campaign.filters?.companySize || ""
        },
        already.map((lead) => lead.name).filter(Boolean)
      );

      if (runId) findallRunIds[idx] = runId;
      await persistMatches(matches, idx, obj.objective);
      logger.info({
        objectiveIndex: idx,
        matchCount: matches.length,
        saved: createdLeads.filter((lead) => lead.sourceObjectiveIndex === idx).length
      }, "Objective discovery complete");
    } catch (err: any) {
      if (isRateLimitError(err)) throw err;
      logger.warn({ err, objectiveIndex: idx }, "Query discovery stopped");
      eventBus.emitProgress({
        campaignId,
        stage: "discover",
        current: 2,
        total: 5,
        message: `Query ${idx + 1} stopped: ${err.message || "discovery failed"}. Use Continue to finish it.`,
        objectiveIndex: idx,
        objective: obj.objective
      });
    }
  }

  campaign.findallRunIds = findallRunIds;

  if (!isDbConnected()) {
    inMemoryLeads.set(campaignId, memStore);
  }

  campaign.stats.found = createdLeads.length;
  await saveCampaign(campaign);

  logger.info({ campaignId, totalFound: createdLeads.length }, "Stage 2 discovery complete");

  // ── Stage 3 + 4: Search + Task + Score, one company at a time ────
  logger.info({ campaignId, count: createdLeads.length }, "Stage 3+4: Enriching and scoring leads with Search + Task APIs");
  campaign.progress = {
    stage: "enrich",
    current: 3,
    total: 5,
    message: `Researching ${createdLeads.length} companies with live search and task research...`
  };
  eventBus.emitProgress({
    campaignId,
    stage: "enrich",
    current: 3,
    total: 5,
    message: `Running live search and task research for ${createdLeads.length} companies...`
  });

  const unscored = createdLeads.filter((lead) => lead.score?.total == null);
  for (const lead of unscored) {
    await enrichLimit(() => enrichAndScoreLead(lead, campaign, campaignId));
  }

  const totalHot = createdLeads.filter((lead) => lead.score?.tier === "hot").length;
  const totalWarm = createdLeads.filter((lead) => lead.score?.tier === "warm").length;
  const totalCold = createdLeads.filter((lead) => lead.score?.tier === "cold").length;

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
  const previousStatus = campaign.status;

  campaign.status = "running";
  campaign.progress = {
    stage: "discover",
    current: 2,
    total: 5,
    message: `Finding leads for query ${objectiveIndex + 1}: ${obj.objective}`
  };
  await saveCampaign(campaign);
  eventBus.emitProgress({
    campaignId,
    stage: "discover",
    current: 2,
    total: 5,
    message: `Finding leads for query ${objectiveIndex + 1}: ${obj.objective}`,
    objectiveIndex,
    objective: obj.objective
  });

  logger.info(
    { campaignId, objectiveIndex, objective: obj.objective.slice(0, 80), existingRunId },
    "Finding more leads for objective"
  );

  const memStore: any[] = isDbConnected() ? [] : (inMemoryLeads.get(campaignId) || []);
  let newLeadsCount = 0;
  let alreadyKnown = 0;
  const seenDomains = new Set<string>();

  const persistFound = async (batch: FindAllMatch[]) => {
    for (const match of batch) {
      const identity = companyIdentity(match.name, match.url);
      if (!identity || seenDomains.has(identity.domain)) continue;
      const { website, domain } = identity;
      seenDomains.add(domain);

      const lead = await upsertLead(
        campaignId,
        {
          name: match.name || domain,
          website,
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
      } else {
        alreadyKnown++;
      }
    }
  };

  let excludeNames: string[] = [];
  if (isDbConnected()) {
    const known = await Lead.find({ campaignId }).select("name").limit(40).lean();
    excludeNames = known.map((row: any) => row.name).filter(Boolean);
  } else {
    excludeNames = (inMemoryLeads.get(campaignId) || []).map((row: any) => row.name).filter(Boolean);
  }

  let matches: FindAllMatch[] = [];
  let runId = "";
  try {
    const found = await discoverLeadsForObjective(
      obj.objective,
      objectiveIndex,
      campaign,
      LEADS_PER_QUERY,
      existingRunId || undefined,
      persistFound,
      obj.queries || [],
      60_000,
      { country: obj.country || campaign.filters?.country, city: obj.city || campaign.filters?.city || "", companySize: obj.companySize || campaign.filters?.companySize || "" },
      excludeNames
    );
    matches = found.matches;
    runId = found.runId;
  } catch (err: any) {
    campaign.status = "failed";
    campaign.progress = {
      stage: "failed",
      current: 2,
      total: 5,
      message: isRateLimitError(err)
        ? "Rate limit reached. Saved companies stay in the list. Use Continue when the limit clears."
        : (err.message || "Finding leads failed")
    };
    await saveCampaign(campaign);
    throw err;
  }

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
  campaign.status = previousStatus === "failed" ? "completed" : previousStatus === "running" ? "completed" : previousStatus || "completed";
  campaign.progress = {
    stage: "completed",
    current: 5,
    total: 5,
    message: newLeadsCount
      ? `Added ${newLeadsCount} new companies for query ${objectiveIndex + 1}.`
      : `Query ${objectiveIndex + 1} finished. ${alreadyKnown} matching companies were already in this campaign.`
  };
  await saveCampaign(campaign);
  eventBus.emitProgress({
    campaignId,
    stage: "completed",
    current: 5,
    total: 5,
    message: campaign.progress.message,
    objectiveIndex,
    objective: obj.objective
  });
  eventBus.emitDone({ campaignId, stats: campaign.stats });

  logger.info({ campaignId, objectiveIndex, newLeadsCount, alreadyKnown }, "Find more leads complete");
  return newLeadsCount;
}

export async function releaseStuckCampaigns(): Promise<void> {
  if (!isDbConnected()) return;
  const result = await Campaign.updateMany(
    { status: "running" },
    {
      $set: {
        status: "failed",
        "progress.stage": "failed",
        "progress.message": "The previous run stopped. Use Continue to finish the companies already found."
      }
    }
  );
  if (result.modifiedCount) {
    logger.warn({ count: result.modifiedCount }, "Released campaigns left in a running state");
  }
}

export async function continueObjective(campaignId: string, objectiveIndex: number): Promise<void> {
  let campaign: any = null;
  if (isDbConnected()) campaign = await Campaign.findById(campaignId);
  else campaign = inMemoryCampaigns.get(campaignId);
  if (!campaign || !campaign.searchObjectives?.[objectiveIndex]) {
    throw new Error("Campaign or objective not found");
  }

  const obj = campaign.searchObjectives[objectiveIndex];
  campaign.status = "running";
  campaign.progress = {
    stage: "discover",
    current: 2,
    total: 5,
    message: `Continuing query ${objectiveIndex + 1}`
  };
  await saveCampaign(campaign);

  try {
    const existing = isDbConnected()
      ? await Lead.find({ campaignId, sourceObjectiveIndex: objectiveIndex })
      : (inMemoryLeads.get(campaignId) || []).filter((lead: any) => lead.sourceObjectiveIndex === objectiveIndex);

    const gap = Math.max(0, LEADS_PER_QUERY - existing.length);
    if (gap > 0) {
      const memStore: any[] = isDbConnected() ? [] : (inMemoryLeads.get(campaignId) || []);
      await discoverLeadsForObjective(
        obj.objective,
        objectiveIndex,
        campaign,
        gap,
        campaign.findallRunIds?.[objectiveIndex] || undefined,
        async (batch) => {
          for (const match of batch) {
            const identity = companyIdentity(match.name, match.url);
            if (!identity) continue;
            const lead = await upsertLead(campaignId, {
              name: match.name || identity.domain,
              website: identity.website,
              domain: identity.domain,
              description: match.description || "",
              objectiveIndex,
              sourceObjectiveQuery: obj.objective,
              attributes: match.attributes
            }, memStore);
            if (lead) eventBus.emitLeadAdded({ campaignId, lead });
          }
        },
        obj.queries || [],
        45_000,
        {
          country: obj.country || campaign.filters?.country,
          city: obj.city || campaign.filters?.city || "",
          companySize: obj.companySize || campaign.filters?.companySize || ""
        },
        existing.map((lead: any) => lead.name).filter(Boolean)
      );
    }

    const current = isDbConnected()
      ? await Lead.find({ campaignId, sourceObjectiveIndex: objectiveIndex })
      : (inMemoryLeads.get(campaignId) || []).filter((lead: any) => lead.sourceObjectiveIndex === objectiveIndex);
    const unscored = current.filter((lead: any) => lead.score?.total == null);
    campaign.progress = {
      stage: unscored.length ? "score" : "completed",
      current: 4,
      total: 5,
      message: unscored.length
        ? `Scoring ${unscored.length} saved companies for query ${objectiveIndex + 1}`
        : `Query ${objectiveIndex + 1} is already scored`
    };
    await saveCampaign(campaign);
    eventBus.emitProgress({
      campaignId,
      stage: campaign.progress.stage,
      current: 4,
      total: 5,
      message: campaign.progress.message,
      objectiveIndex,
      objective: obj.objective
    });

    for (const lead of unscored) {
      await enrichAndScoreLead(lead, campaign, campaignId);
    }

    campaign.status = "completed";
    campaign.progress = {
      stage: "completed",
      current: 5,
      total: 5,
      message: `Query ${objectiveIndex + 1} continued. ${unscored.length} companies were scored.`
    };
    await saveCampaign(campaign);
    eventBus.emitDone({ campaignId, stats: campaign.stats });
  } catch (err: any) {
    campaign.status = "failed";
    campaign.progress = {
      stage: "failed",
      current: 4,
      total: 5,
      message: isRateLimitError(err)
        ? "Rate limit reached. Saved companies stay in the list. Use Continue when the limit clears."
        : (err.message || "Continue failed")
    };
    await saveCampaign(campaign);
    throw err;
  }
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
