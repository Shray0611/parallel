import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const envSchema = z.object({
  PORT: z.coerce.number().default(4000),
  MONGODB_URI: z.string().default("mongodb://localhost:27017/leadscope"),
  JWT_SECRET: z.string().default("leadscope_super_secret_jwt_key_2026_dev"),
  GEMINI_API_KEY: z.string().optional().default(""),
  GEMINI_MODEL: z.string().default("gemini-3.8-flash"),
  PARALLEL_API_KEY: z.string().optional().default(""),
  PARALLEL_SEARCH_MODE: z.enum(["turbo", "fast", "basic", "advanced"]).default("fast"),
  ENTITY_MATCH_LIMIT: z.coerce.number().default(25),
  MAX_LEADS_PER_CAMPAIGN: z.coerce.number().default(40),
  DEMO_MODE: z.string().transform((val) => val === "true" || val === "1").default("true")
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("❌ Invalid environment variables:", parsed.error.format());
  process.exit(1);
}

export const env = parsed.data;
