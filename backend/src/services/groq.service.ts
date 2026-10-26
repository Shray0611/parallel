import Groq from "groq-sdk";
import { z } from "zod";
import { env } from "../config/env.js";
import { logger } from "../config/logger.js";
import { cached } from "../utils/cache.js";

const groq = new Groq({
  apiKey: env.GROQ_API_KEY || "dummy_key_for_initialization"
});

// Zod schemas for Groq outputs
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

// Helper for calling Groq with JSON mode, retry, and Zod validation
async function callGroqJson<T>(
  systemPrompt: string,
  userPrompt: string,
  schema: z.ZodSchema<T>,
  temperature: number = 0.2
): Promise<T> {
  const modelsToTry = [
    env.GROQ_MODEL,
    "llama-3.1-70b-versatile",
    "llama-3.1-8b-instant",
    "llama3-70b-8192"
  ].filter(Boolean);

  let lastError: any = null;

  for (const model of modelsToTry) {
    async function executeCall(temp: number): Promise<T> {
      const completion = await groq.chat.completions.create({
        model,
        temperature: temp,
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
      if (!raw) {
        throw new Error("Empty response received from Groq");
      }

      const parsed = JSON.parse(raw);
      return schema.parse(parsed);
    }

    try {
      try {
        return await executeCall(temperature);
      } catch (err: any) {
        if (err?.status === 404 || err?.message?.includes("model_not_found")) {
          throw err; // Try next model immediately
        }
        logger.warn({ err }, "Groq JSON parse or validation failed on first attempt; retrying with temperature 0");
        return await executeCall(0);
      }
    } catch (err: any) {
      lastError = err;
      if (err?.status === 404 || err?.message?.includes("model_not_found")) {
        logger.warn({ model }, "Groq model not found or unavailable, falling back to alternative model");
        continue;
      }
      throw err;
    }
  }

  throw lastError || new Error("All Groq model attempts failed");
}

export class GroqService {
  // Test connection
  static async ping(): Promise<boolean> {
    if (!env.GROQ_API_KEY) return false;
    const modelsToTry = [
      env.GROQ_MODEL,
      "llama-3.1-70b-versatile",
      "llama-3.1-8b-instant",
      "llama3-70b-8192"
    ].filter(Boolean);

    for (const model of modelsToTry) {
      try {
        const res = await groq.chat.completions.create({
          model,
          temperature: 0,
          max_tokens: 10,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: "Return JSON { \"status\": \"ok\" }" },
            { role: "user", content: "ping" }
          ]
        });
        const parsed = JSON.parse(res.choices[0]?.message?.content || "{}");
        if (parsed.status === "ok") return true;
      } catch (err: any) {
        if (err?.status === 404 || err?.message?.includes("model_not_found")) {
          continue;
        }
        logger.warn({ err }, "Groq ping failed");
        return false;
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

    return cached("groq", cacheKey, async () => {
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

      return await callGroqJson(systemPrompt, userPrompt, icpOutputSchema);
    });
  }

  // Stage 3: Generate search queries for lead enrichment
  static async generateLeadQueries(
    companyName: string,
    description: string,
    offering: string
  ): Promise<LeadQueryOutput> {
    const cacheKey = { action: "lead_queries", companyName, description, offering };

    return cached("groq", cacheKey, async () => {
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

      return await callGroqJson(systemPrompt, userPrompt, leadQueryOutputSchema);
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

    return cached("groq", cacheKey, async () => {
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

      return await callGroqJson(systemPrompt, userPrompt, scoreOutputSchema);
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

    return await callGroqJson(systemPrompt, userPrompt, outreachOnlySchema);
  }
}
