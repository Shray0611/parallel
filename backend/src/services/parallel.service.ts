import { fetch } from "undici";
import { env } from "../config/env.js";
import { logger } from "../config/logger.js";
import { cached } from "../utils/cache.js";

export interface ParallelEntity {
  name: string;
  url: string;
  description: string;
}

export interface ParallelEntitySearchResponse {
  entity_set_id: string;
  entities: ParallelEntity[];
}

export interface ParallelSearchResultItem {
  url: string;
  title: string | null;
  publish_date: string | null;
  excerpts: string[];
}

export interface ParallelSearchResponse {
  search_id: string;
  results: ParallelSearchResultItem[];
  warnings?: any[] | null;
  usage?: Array<{ name: string; count: number }> | null;
  session_id: string;
}

export class ParallelService {
  private static readonly BASE_URL_ENTITY = "https://api.parallel.ai/v1beta/findall/entity-search";
  private static readonly BASE_URL_SEARCH = "https://api.parallel.ai/v1/search";

  // Test API key validity
  static async ping(): Promise<boolean> {
    if (!env.PARALLEL_API_KEY) return false;
    try {
      const res = await fetch(this.BASE_URL_ENTITY, {
        method: "POST",
        headers: {
          "x-api-key": env.PARALLEL_API_KEY,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          entity_type: "companies",
          objective: "technology companies in India",
          match_limit: 5
        })
      });
      return res.status >= 200 && res.status < 300;
    } catch (err) {
      logger.warn({ err }, "Parallel ping failed");
      return false;
    }
  }

  // 1. Entity Search: Discover companies
  static async entitySearch(
    objective: string,
    matchLimit: number = env.ENTITY_MATCH_LIMIT
  ): Promise<ParallelEntitySearchResponse> {
    const body = {
      entity_type: "companies",
      objective,
      match_limit: matchLimit
    };

    return cached("parallel_entity", body, async () => {
      logger.info({ objective, matchLimit }, "Executing Parallel Entity Search");

      const response = await fetch(this.BASE_URL_ENTITY, {
        method: "POST",
        headers: {
          "x-api-key": env.PARALLEL_API_KEY,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(body)
      });

      if (!response.ok) {
        const errorData: any = await response.json().catch(() => ({}));
        const message = errorData?.error?.message || `Parallel Entity Search failed with status ${response.status}`;
        logger.error({ status: response.status, errorData }, message);
        throw new Error(message);
      }

      const data = (await response.json()) as ParallelEntitySearchResponse;
      return {
        entity_set_id: data.entity_set_id || "",
        entities: data.entities || []
      };
    });
  }

  // 2. Search API: Enrich single company (NOT cached — each company gets unique live results)
  static async enrichCompany(
    objective: string,
    searchQueries: string[],
    countryCode: string,
    sessionId: string
  ): Promise<ParallelSearchResponse> {
    const location = (countryCode || "in").toLowerCase();

    // Sanitize search queries: 3-6 words, no site:, no punctuation questions
    const sanitizedQueries = searchQueries.map((q) =>
      q.replace(/site:[^\s]+/gi, "").trim()
    ).filter(Boolean);

    const body = {
      objective,
      search_queries: sanitizedQueries.slice(0, 5),
      mode: env.PARALLEL_SEARCH_MODE || "fast",
      max_chars_total: 6000,
      session_id: sessionId,
      advanced_settings: {
        location,
        max_results: 5,
        source_policy: {
          exclude_domains: ["youtube.com", "facebook.com", "instagram.com", "pinterest.com"]
        }
      }
    };

    logger.info(
      { objective: objective.slice(0, 80), queriesCount: sanitizedQueries.length, location, sessionId },
      "Executing Parallel Search Enrichment"
    );

    const response = await fetch(this.BASE_URL_SEARCH, {
      method: "POST",
      headers: {
        "x-api-key": env.PARALLEL_API_KEY,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      const errorData: any = await response.json().catch(() => ({}));
      const message =
        errorData?.error?.message ||
        `Parallel Search failed with status ${response.status}`;
      logger.error({ status: response.status, errorData, objective: objective.slice(0, 80) }, message);
      throw new Error(message);
    }

    const data = (await response.json()) as ParallelSearchResponse;
    logger.info(
      { resultsCount: data.results?.length || 0, searchId: data.search_id },
      "Parallel Search enrichment complete"
    );
    return {
      search_id: data.search_id || "",
      results: data.results || [],
      session_id: data.session_id || sessionId
    };
  }
}
