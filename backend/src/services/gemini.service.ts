import { GoogleGenerativeAI } from "@google/generative-ai";
import { z } from "zod";
import { env } from "../config/env.js";
import { logger } from "../config/logger.js";
import { cached } from "../utils/cache.js";

const genAI = new GoogleGenerativeAI(env.GEMINI_API_KEY || "dummy_key_for_initialization");

// Helper to strip markdown code blocks if present
function extractJson(text: string): string {
  let cleaned = text.trim();
  if (cleaned.startsWith("```json")) {
    cleaned = cleaned.replace(/^```json\s*/i, "").replace(/\s*```$/i, "");
  } else if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```\s*/, "").replace(/\s*```$/, "");
  }
  return cleaned.trim();
}

// Zod schemas for Gemini outputs
export const icpOutputSchema = z.object({
  icp: z.object({
    summary: z.string(),
    painPoints: z.array(z.string()).min(1),
    buyerPersonas: z.array(z.string()).min(1),
    disqualifiers: z.array(z.string()).min(1)
  }),
  searchObjectives: z
    .array(
      z.object({
        objective: z.string(),
        rationale: z.string()
      })
    )
    .min(3)
    .max(5)
});

export const leadQueryOutputSchema = z.object({
  objective: z.string(),
  search_queries: z.array(z.string()).min(2).max(5)
});

export const scoreOutputSchema = z.object({
  score: z.object({
    total: z.number().min(0).max(100),
    fit: z.number().min(0).max(40),
    intent: z.number().min(0).max(30),
    reachability: z.number().min(0).max(30),
    tier: z.enum(["hot", "warm", "cold"]),
    reasons: z.array(z.string()),
    whyNow: z.string(),
    pitchAngle: z.string(),
    recommendedProduct: z.string(),
    estimatedSize: z.string(),
    industry: z.string(),
    location: z.string(),
    risks: z.array(z.string())
  }),
  outreach: z.object({
    subject: z.string(),
    email: z.string(),
    linkedinNote: z.string()
  })
});

export const outreachOnlySchema = z.object({
  subject: z.string(),
  email: z.string(),
  linkedinNote: z.string()
});

export type IcpOutput = z.infer<typeof icpOutputSchema>;
export type LeadQueryOutput = z.infer<typeof leadQueryOutputSchema>;
export type ScoreOutput = z.infer<typeof scoreOutputSchema>;
export type OutreachOnlyOutput = z.infer<typeof outreachOnlySchema>;

// Helper for calling Gemini with JSON mode, fallback models, retry, and Zod validation
async function callGeminiJson<T>(
  systemPrompt: string,
  userPrompt: string,
  schema: z.ZodSchema<T>,
  temperature: number = 0.2
): Promise<T> {
  const modelsToTry = [
    ...new Set([
      env.GEMINI_MODEL,
      "gemini-3.8-flash",
      "gemini-3.6-flash",
      "gemini-3.5-flash-lite",
      "gemini-flash-lite-latest",
      "gemini-3.7-flash",
      "gemini-3.5-flash"
    ])
  ].filter(Boolean);

  let lastError: any = null;

  for (const modelName of modelsToTry) {
    async function executeCall(temp: number): Promise<T> {
      const model = genAI.getGenerativeModel({
        model: modelName,
        systemInstruction: `${systemPrompt}\nYou MUST return a valid JSON object matching the requested schema. Do not include markdown codeblocks or preamble.`,
        generationConfig: {
          responseMimeType: "application/json",
          temperature: temp
        }
      });

      const response = await model.generateContent(userPrompt);
      const rawText = response.response.text();
      if (!rawText) {
        throw new Error("Empty response received from Gemini");
      }

      const cleaned = extractJson(rawText);
      const parsed = JSON.parse(cleaned);
      return schema.parse(parsed);
    }

    try {
      try {
        return await executeCall(temperature);
      } catch (err: any) {
        const msg = err?.message || String(err);
        if (msg.includes("503") || msg.includes("high demand") || msg.includes("404") || msg.includes("no longer available")) {
          throw err;
        }
        logger.warn({ err: err?.message || err, model: modelName }, "Gemini call failed on first attempt; retrying with temperature 0");
        return await executeCall(0);
      }
    } catch (err: any) {
      lastError = err;
      logger.warn({ err: err?.message || err, model: modelName }, "Gemini model attempt failed, falling back to alternative model");
      continue;
    }
  }

  throw lastError || new Error("All Gemini model attempts failed");
}

export class GeminiService {
  // Test connection
  static async ping(): Promise<boolean> {
    if (!env.GEMINI_API_KEY || env.GEMINI_API_KEY.trim().length === 0) return false;
    const modelsToTry = [
      ...new Set([
        env.GEMINI_MODEL,
        "gemini-3.8-flash",
        "gemini-3.6-flash",
        "gemini-3.5-flash-lite",
        "gemini-flash-lite-latest"
      ])
    ].filter(Boolean);

    for (const modelName of modelsToTry) {
      try {
        const model = genAI.getGenerativeModel({
          model: modelName,
          generationConfig: {
            responseMimeType: "application/json",
            temperature: 0
          }
        });
        const res = await model.generateContent('Return JSON: { "status": "ok" }');
        const text = extractJson(res.response.text() || "{}");
        const parsed = JSON.parse(text);
        if (parsed.status === "ok") return true;
      } catch (err: any) {
        logger.warn({ err: err?.message || err, model: modelName }, "Gemini ping failed on model");
        continue;
      }
    }
    return false;
  }

  // Stage 1: Generate ICP & Search Objectives
  static async generateICP(
    offering: string,
    valueProps: string[],
    filters: {
      country: string;
      city?: string;
      companySize: string;
      domains: string[];
    }
  ): Promise<IcpOutput> {
    const cacheKey = { action: "generate_icp", offering, valueProps, filters };

    return cached("gemini", cacheKey, async () => {
      const systemPrompt = `You are a B2B sales strategist for Cerelabs, an enterprise AI products company.
You must output a JSON object with:
1. "icp": {
     "summary": string,
     "painPoints": string[],
     "buyerPersonas": string[],
     "disqualifiers": string[]
   }
2. "searchObjectives": array of 3 to 5 objects: [ { "objective": string, "rationale": string } ]

CRITICAL RULES for searchObjectives:
- Each "objective" is used directly by an entity search engine to find real companies.
- Keep objectives focused on the core criterion (industry + country + size), not a long list of conditions.
- Every single objective MUST explicitly mention the country "${filters.country}" and company size "${filters.companySize} employees".
- Example objective format: "Mid-sized pharmaceutical manufacturers in ${filters.country} (${filters.companySize} employees) with large regulatory documentation that could benefit from document-AI / RAG".
- Include distinct target angles across the requested domains: ${filters.domains.join(", ") || "target tech and enterprise sectors"}.`;

      const userPrompt = `Cerelabs Offering: ${offering}
Core Value Propositions:
${valueProps.map((vp) => `- ${vp}`).join("\n")}

Filters:
- Target Country: ${filters.country} ${filters.city ? `(${filters.city})` : ""}
- Target Company Size: ${filters.companySize} employees
- Target Industry Domains: ${filters.domains.join(", ") || "General Enterprise"}`;

      return await callGeminiJson(systemPrompt, userPrompt, icpOutputSchema);
    });
  }

  // Stage 3: Generate search queries for lead enrichment
  static async generateLeadQueries(
    companyName: string,
    description: string,
    offering: string
  ): Promise<LeadQueryOutput> {
    // Cache key includes companyName as primary unique identifier — two companies never share queries
    const cacheKey = { action: "lead_queries", companyName, description: description?.slice(0, 100), offering };

    return cached("gemini", cacheKey, async () => {
      const systemPrompt = `You are an AI research query generator for B2B lead enrichment.
Generate search queries to enrich a target company using live web data.
You must output a JSON object with:
1. "objective": a self-contained sentence describing what we want to learn about the company and why regarding "${offering}".
2. "search_queries": array of 3 keyword queries.

RULES for search_queries:
- Exactly 3 queries.
- Each query must be 3 to 6 words long.
- Include the exact company name "${companyName}" in every query.
- NEVER send complete sentences or questions in search_queries.
- NEVER use operators like "site:".
- Example queries for "Acme Corp":
  - "Acme Corp AI initiatives 2026"
  - "Acme Corp document management systems"
  - "Acme Corp hiring data engineer"`;

      const userPrompt = `Company Name: ${companyName}
Company Description: ${description}
Cerelabs Product Offering: ${offering}`;

      return await callGeminiJson(systemPrompt, userPrompt, leadQueryOutputSchema);
    });
  }

  // Stage 4: Score lead and draft outreach
  static async scoreAndDraft(
    icpSummary: string,
    companyName: string,
    description: string,
    excerpts: string[],
    offering: string
  ): Promise<ScoreOutput> {
    const combinedExcerpts = excerpts.slice(0, 10).join("\n---\n").slice(0, 5000);
    const cacheKey = { action: "score_lead", companyName, description, offering, excerpts: combinedExcerpts };

    return cached("gemini", cacheKey, async () => {
      const systemPrompt = `You are an enterprise AI deal qualification director and outreach copywriter for Cerelabs.
You evaluate companies against an Ideal Customer Profile (ICP) based on live web evidence, assign a 0-100 score, and write tailored outreach.

Output JSON matching this exact structure:
{
  "score": {
    "total": number (0-100, equal to fit + intent + reachability),
    "fit": number (0-40, based on company size, industry, business model relevance),
    "intent": number (0-30, based on tech hiring, digital transformation signals, AI initiatives in web evidence),
    "reachability": number (0-30, based on clarity of leadership and operational presence),
    "tier": "hot" (if total >= 70) | "warm" (if total 45-69) | "cold" (if total < 45),
    "reasons": string[] (3-4 bullet points justifying the score),
    "whyNow": string (a concise signal why reaching out now makes sense),
    "pitchAngle": string (recommended strategic angle to pitch "${offering}"),
    "recommendedProduct": string (specific Cerelabs product capability),
    "estimatedSize": string,
    "industry": string,
    "location": string,
    "risks": string[] (1-2 potential blockers or disqualifiers)
  },
  "outreach": {
    "subject": string (high-converting, punchy subject line without clickbait),
    "email": string (<=150 words, plain text, personalised with ONE concrete fact from the web excerpts),
    "linkedinNote": string (<=300 characters, concise networking connect note)
  }
}`;

      const userPrompt = `ICP Target:
${icpSummary}

Target Company:
Name: ${companyName}
Description: ${description}
Product We Are Selling: ${offering}

Live Web Evidence & Excerpts:
${combinedExcerpts || "No live excerpts available. Rely on company profile."}`;

      return await callGeminiJson(systemPrompt, userPrompt, scoreOutputSchema);
    });
  }

  // Outreach regeneration with custom tone
  static async regenerateOutreach(
    leadName: string,
    description: string,
    pitchAngle: string,
    whyNow: string,
    offering: string,
    excerpts: string[],
    tone: "formal" | "friendly" | "short"
  ): Promise<OutreachOnlyOutput> {
    const toneGuide = {
      formal: "Executive, boardroom-ready, professional, emphasizing ROI and enterprise governance.",
      friendly: "Warm, collaborative, curious peer-to-peer tone.",
      short: "Ultra-brief, 3-4 sentences max, frictionless call-to-action."
    }[tone];

    const systemPrompt = `You are an expert sales copywriter writing a personalized cold outreach email and LinkedIn connection note.
Tone requirement: ${toneGuide}

Output JSON with:
{
  "subject": string,
  "email": string (<= 150 words, plain text, references one concrete detail from the company),
  "linkedinNote": string (<= 300 characters)
}`;

    const userPrompt = `Company: ${leadName}
Description: ${description}
Product: ${offering}
Pitch Angle: ${pitchAngle}
Why Now Signal: ${whyNow}
Evidence:
${excerpts.slice(0, 3).join("\n")}`;

    return await callGeminiJson(systemPrompt, userPrompt, outreachOnlySchema);
  }
}
