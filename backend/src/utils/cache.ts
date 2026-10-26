import crypto from "crypto";
import { ApiCache } from "../models/ApiCache.js";
import { isDbConnected } from "../config/db.js";
import { logger } from "../config/logger.js";

// In-memory fallback cache
const memoryCache = new Map<string, { response: any; createdAt: number }>();

export function hashKey(provider: string, body: any): string {
  const serialized = typeof body === "string" ? body : JSON.stringify(body);
  return crypto.createHash("sha256").update(`${provider}:${serialized}`).digest("hex");
}

export async function cached<T>(
  provider: "gemini" | "groq" | "parallel_entity" | "parallel_search",
  body: any,
  fn: () => Promise<T>
): Promise<T> {
  const key = hashKey(provider, body);

  // Check MongoDB if connected
  if (isDbConnected()) {
    try {
      const hit = await ApiCache.findOne({ key });
      if (hit) {
        logger.debug({ provider, key: key.slice(0, 10) }, "Cache HIT (MongoDB)");
        return hit.response as T;
      }
    } catch (err) {
      logger.warn({ err }, "Error checking MongoDB cache, falling back to execution");
    }
  } else {
    // Check in-memory
    const memoryHit = memoryCache.get(key);
    if (memoryHit && Date.now() - memoryHit.createdAt < 7 * 24 * 60 * 60 * 1000) {
      logger.debug({ provider, key: key.slice(0, 10) }, "Cache HIT (Memory)");
      return memoryHit.response as T;
    }
  }

  logger.debug({ provider, key: key.slice(0, 10) }, "Cache MISS -> calling API");
  const result = await fn();

  // Store in cache
  if (isDbConnected()) {
    try {
      await ApiCache.updateOne(
        { key },
        { key, provider, response: result, createdAt: new Date() },
        { upsert: true }
      );
    } catch (err) {
      logger.warn({ err }, "Could not write to MongoDB ApiCache");
    }
  } else {
    memoryCache.set(key, { response: result, createdAt: Date.now() });
  }

  return result;
}
