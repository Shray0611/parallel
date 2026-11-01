import { GoogleGenerativeAI } from "@google/generative-ai";
import Groq from "groq-sdk";
import { z } from "zod";
import { env } from "../config/env.js";
import { logger } from "../config/logger.js";
import { cached } from "../utils/cache.js";
import { isRateLimitError } from "../utils/errors.js";
import { placeLabel } from "../utils/location.js";

// Initialize clients
const groq = new Groq({
  apiKey: env.GROQ_API_KEY || "dummy_key_for_init"
});

const genAI = new GoogleGenerativeAI(
  env.GEMINI_API_KEY || "dummy_key_for_init"
);

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

// Zod schemas
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
        domain: z.string(),
        objective: z.string(),
        rationale: z.string(),
        queries: z.array(z.string()).min(2).max(4)
      })
    )
    .min(1)
    .max(6)
});

export const objectiveDraftSchema = z.object({
  domain: z.string(),
  objective: z.string(),
  rationale: z.string(),
  queries: z.array(z.string()).min(2).max(4)
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

// Global tracker for which provider handled the latest request
let lastUsedProvider: "groq" | "gemini" = "groq";

// 1. Internal Groq caller
async function callGroqJson<T>(
  systemPrompt: string,
  userPrompt: string,
  schema: z.ZodSchema<T>,
  temperature: number = 0.2
): Promise<T> {
  if (!env.GROQ_API_KEY || env.GROQ_API_KEY.trim().length === 0) {
    throw new Error("GROQ_API_KEY not configured");
  }

  const modelsToTry = [
    ...new Set([
      env.GROQ_MODEL,
      "openai/gpt-oss-120b",
      "openai/gpt-oss-20b",
      "qwen/qwen3.8-27b",
      "llama-3.3-70b-versatile"
    ])
  ].filter(Boolean);

  let lastError: any = null;

  for (const model of modelsToTry) {
    try {
      const completion = await groq.chat.completions.create({
        model,
        temperature,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: `${systemPrompt}\nYou MUST return a valid JSON object matching the requested schema. Do not include markdown codeblocks or preamble.`
          },
          {
            role: "user",
            content: userPrompt
          }
        ]
      });

      const raw = completion.choices[0]?.message?.content;
      if (!raw) throw new Error("Empty response received from Groq");

      const cleaned = extractJson(raw);
      const parsed = JSON.parse(cleaned);
      return schema.parse(parsed);
    } catch (err: any) {
      lastError = err;
      if (isRateLimitError(err)) throw err;
      logger.warn({ model, err: err?.message || err }, "Groq model attempt failed, trying next Groq model");
      continue;
    }
  }

  throw lastError || new Error("All Groq models failed");
}

// 2. Internal Gemini caller
async function callGeminiInternal<T>(
  systemPrompt: string,
  userPrompt: string,
  schema: z.ZodSchema<T>,
  temperature: number = 0.2
): Promise<T> {
  if (!env.GEMINI_API_KEY || env.GEMINI_API_KEY.trim().length === 0) {
    throw new Error("GEMINI_API_KEY not configured");
  }

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
      if (!rawText) throw new Error("Empty response received from Gemini");

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
      if (isRateLimitError(err)) throw err;
      logger.warn({ err: err?.message || err, model: modelName }, "Gemini model attempt failed, falling back to alternative model");
      continue;
    }
  }

  throw lastError || new Error("All Gemini model attempts failed");
}

// 3. Fallback Orchestrator: Try Groq first; if Groq fails, switch to Gemini
async function callLLMWithFallback<T>(
  systemPrompt: string,
  userPrompt: string,
  schema: z.ZodSchema<T>,
  temperature: number = 0.2
): Promise<T> {
  // Step 1: Try Groq
  if (env.GROQ_API_KEY && env.GROQ_API_KEY.trim().length > 0) {
    try {
      const groqRes = await callGroqJson(systemPrompt, userPrompt, schema, temperature);
      lastUsedProvider = "groq";
      logger.info("✅ Groq responded successfully with valid output");
      return groqRes;
    } catch (groqErr: any) {
      logger.warn(
        { err: groqErr?.message || groqErr },
        "⚠️ Groq failed or gave error; switching to Gemini fallback"
      );
    }
  }

  // Step 2: Fallback to Gemini
  try {
    const geminiRes = await callGeminiInternal(systemPrompt, userPrompt, schema, temperature);
    lastUsedProvider = "gemini";
    logger.info("✅ Gemini responded successfully");
    return geminiRes;
  } catch (geminiErr: any) {
    logger.error({ err: geminiErr?.message || geminiErr }, "❌ Both Groq and Gemini failed");
    throw geminiErr;
  }
}

export class GeminiService {
  // Access which provider fulfilled the last request
  static getLastProvider(): "groq" | "gemini" {
    return lastUsedProvider;
  }

  // Test Groq connection specifically
  static async pingGroq(): Promise<boolean> {
    if (!env.GROQ_API_KEY || env.GROQ_API_KEY.trim().length === 0) return false;
    const modelsToTry = [
      ...new Set([
        env.GROQ_MODEL,
        "openai/gpt-oss-120b",
        "openai/gpt-oss-20b",
        "qwen/qwen3.8-27b",
        "llama-3.3-70b-versatile"
      ])
    ].filter(Boolean);

    for (const model of modelsToTry) {
      try {
        const res = await groq.chat.completions.create({
          model,
          temperature: 0,
          max_tokens: 50,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: 'Return JSON: { "status": "ok" }' },
            { role: "user", content: "ping" }
          ]
        });
        const cleaned = extractJson(res.choices[0]?.message?.content || "{}");
        const parsed = JSON.parse(cleaned);
        if (parsed.status === "ok") return true;
      } catch (err: any) {
        logger.debug({ model, err: err?.message || err }, "Groq ping model attempt failed");
        continue;
      }
    }
    return false;
  }

  // Test Gemini connection specifically
  static async pingGemini(): Promise<boolean> {
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
        continue;
      }
    }
    return false;
  }

  // General ping: returns true if either Groq or Gemini is active
  static async ping(): Promise<boolean> {
    const groqOk = await this.pingGroq();
    if (groqOk) return true;
    return await this.pingGemini();
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
    },
    options?: { fresh?: boolean }
  ): Promise<IcpOutput> {
    const cacheKey = { action: "generate_icp", offering, valueProps, filters };
    const run = async () => {
      const systemPrompt = `You are a B2B sales strategist for Cerelabs, an enterprise AI products company.
You must output a JSON object with:
1. "icp": {
     "summary": string,
     "painPoints": string[],
     "buyerPersonas": string[],
     "disqualifiers": string[]
   }
2. "searchObjectives": one object per selected industry. Shape:
   { "domain": string, "objective": string, "rationale": string, "queries": string[] }

CRITICAL RULES for searchObjectives:
- Build the list from the user's selected industries only. Do not reuse a sample industry the user did not pick.
- If several industries are selected, return exactly one objective per industry.
- If only one industry is selected, return 3 different buying angles for that same industry.
- "domain" must be one of: ${filters.domains.join(", ") || "Enterprise"}.
- "objective" is the exact sentence that will be sent to a company-discovery engine. One sentence. Name the industry, the country "${filters.country}", and the size "${filters.companySize} employees". Describe the document or workflow pain that matches the offering. Do not name a specific company.
- "queries" is exactly 3 short web queries, each 3 to 6 words, that will be shown to the user before search. Each query names the industry or the workflow, never a company, and never uses site: or quotes.
- "rationale" is one sentence on why this angle fits the offering.
- Keep each objective distinct. Do not repeat the same sentence with a swapped industry noun only when a real workflow difference exists; change the workflow, not just the label.`;

      const userPrompt = `Cerelabs Offering: ${offering}
Core Value Propositions:
${valueProps.map((vp) => `- ${vp}`).join("\n")}

Filters:
- Target Country: ${filters.country} ${filters.city ? `(${filters.city})` : ""}
- Target Company Size: ${filters.companySize} employees
- Target Industry Domains: ${filters.domains.join(", ") || "General Enterprise"}`;

      return await callLLMWithFallback(systemPrompt, userPrompt, icpOutputSchema);
    };

    if (options?.fresh) return run();
    return cached("gemini", cacheKey, run);
  }

  static async enhanceObjective(input: {
    offering: string;
    country: string;
    city?: string;
    companySize: string;
    domains: string[];
    objective: string;
    rationale?: string;
    domain?: string;
  }) {
    const place = placeLabel(input.country, input.city);
    const systemPrompt = `You improve one B2B company-discovery objective for Cerelabs.
Return JSON: { "domain": string, "objective": string, "rationale": string, "queries": string[3] }.
The objective is one sentence a company search engine will receive. It must name the industry, the place "${place}", and size "${input.companySize} employees".
queries are exactly 3 phrases of 3 to 6 words. No company names. No site: operators.
Make the wording more specific to the offering without changing the industry or the place.`;

    const userPrompt = `Offering: ${input.offering}
Industries: ${input.domains.join(", ") || "Enterprise"}
Current domain label: ${input.domain || ""}
Current objective: ${input.objective}
Current rationale: ${input.rationale || ""}`;

    return callLLMWithFallback(systemPrompt, userPrompt, objectiveDraftSchema, 0.4);
  }

  static async generateExtraObjective(input: {
    offering: string;
    country: string;
    city?: string;
    companySize: string;
    domains: string[];
    existing: string[];
    domain?: string;
    focus?: string;
  }) {
    const place = placeLabel(input.country, input.city);
    const systemPrompt = `You write one new B2B company-discovery objective for an existing Cerelabs campaign.
Return JSON: { "domain": string, "objective": string, "rationale": string, "queries": string[3] }.
The user has already chosen the location and industry. Do not change them.
Use industry "${input.domain || input.domains[0] || "Enterprise"}".
The objective must differ from every existing objective. One sentence. Include the place "${place}" and size "${input.companySize} employees".
queries are exactly 3 phrases of 3 to 6 words. No company names.`;

    const userPrompt = `Offering: ${input.offering}
Chosen industry: ${input.domain || "choose the best remaining industry"}
Chosen location: ${place}
Extra focus from the user: ${input.focus || "None"}
Existing objectives:
${input.existing.map((item, index) => `${index + 1}. ${item}`).join("\n") || "None yet"}`;

    return callLLMWithFallback(systemPrompt, userPrompt, objectiveDraftSchema, 0.5);
  }

  // Stage 3: Generate search queries for lead enrichment
  static async generateLeadQueries(
    companyName: string,
    description: string,
    offering: string
  ): Promise<LeadQueryOutput> {
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

      return await callLLMWithFallback(systemPrompt, userPrompt, leadQueryOutputSchema);
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

      return await callLLMWithFallback(systemPrompt, userPrompt, scoreOutputSchema);
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

    return await callLLMWithFallback(systemPrompt, userPrompt, outreachOnlySchema);
  }
}

// Aliases for compatibility
export const GroqService = GeminiService;
export const LLMService = GeminiService;
