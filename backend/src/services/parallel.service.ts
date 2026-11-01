import { fetch } from "undici";
import { env } from "../config/env.js";
import { logger } from "../config/logger.js";
import { cached } from "../utils/cache.js";

const PARALLEL_BASE = "https://api.parallel.ai";

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

export interface FindAllMatchCondition {
  name: string;
  description: string;
}

export interface FindAllIngestResponse {
  objective?: string;
  entity_type?: string;
  match_conditions?: FindAllMatchCondition[];
  generator?: string;
  match_limit?: number;
  [key: string]: any;
}

export interface FindAllRunResponse {
  id: string;
  findall_id?: string;
  status: string;
  is_active?: boolean;
  objective?: string;
  entity_type?: string;
  matches?: FindAllMatch[];
}

export interface FindAllMatch {
  name: string;
  url?: string;
  description?: string;
  matchStatus?: string;
  attributes?: Record<string, any>;
}

export interface FindAllResultResponse {
  id: string;
  status: string;
  matches?: FindAllMatch[];
  error?: string;
}

export interface TaskRunResponse {
  id: string;
  status: string;
  output?: string;
  result?: any;
  error?: string;
}

export interface ExtractResultItem {
  url: string;
  title?: string;
  content?: string;
  summary?: string;
  excerpts?: string[];
  full_content?: string;
  publish_date?: string;
  [key: string]: any;
}

export interface ExtractResponse {
  results: ExtractResultItem[];
  [key: string]: any;
}

export interface MonitorResponse {
  id: string;
  monitor_id?: string;
  status: string;
  query?: string;
  schedule?: string;
  [key: string]: any;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function parallelHeaders() {
  return {
    "x-api-key": env.PARALLEL_API_KEY,
    "Content-Type": "application/json"
  };
}

async function parallelFetch(path: string, init: any = {}): Promise<any> {
  const url = `${PARALLEL_BASE}${path}`;
  const res = await (fetch as any)(url, {
    ...init,
    headers: {
      ...parallelHeaders(),
      ...(init.headers || {})
    }
  });

  if (!res.ok) {
    const errorData: any = await res.json().catch(() => ({}));
    const msg =
      errorData?.error?.message ||
      errorData?.detail ||
      `Parallel API error ${res.status} on ${path}`;
    logger.error({ status: res.status, errorData, path }, msg);
    if (res.status === 429) {
      const rateError = new Error("Parallel rate limit reached. Saved companies stay in the list. Use Continue when the limit clears.");
      rateError.name = "ParallelRateLimitError";
      throw rateError;
    }
    throw new Error(typeof msg === "string" ? msg : JSON.stringify(msg));
  }

  if (res.status === 204) return {};
  const text = await res.text();
  if (!text) return {};
  return JSON.parse(text);
}

function extractId(data: any, ...keys: string[]): string {
  for (const key of keys) {
    if (data?.[key]) return String(data[key]);
  }
  return "";
}

function extractStatus(data: any): string {
  if (!data) return "";
  if (typeof data.status === "string") return data.status;
  if (typeof data.status?.status === "string") return data.status.status;
  if (typeof data.run?.status === "string") return data.run.status;
  if (typeof data.run?.status?.status === "string") return data.run.status.status;
  return "";
}

function isActiveStatus(data: any): boolean {
  if (typeof data?.status?.is_active === "boolean") return data.status.is_active;
  if (typeof data?.run?.status?.is_active === "boolean") return data.run.status.is_active;
  const status = extractStatus(data);
  return status === "queued" || status === "running" || status === "cancelling" || status === "pending";
}

function outputFieldValue(value: any): any {
  if (value == null) return undefined;
  if (typeof value !== "object") return value;
  if ("value" in value) return (value as any).value;
  return value;
}

function findAllCandidateList(data: any): any[] {
  const candidates = data?.candidates || data?.matches || data?.run?.candidates || [];
  return Array.isArray(candidates) ? candidates : [];
}

function summarizeFindAllCandidates(data: any): { total: number; counts: Record<string, number>; metrics?: any } {
  const counts: Record<string, number> = {};
  for (const candidate of findAllCandidateList(data)) {
    const status = String(candidate?.match_status || "unknown");
    counts[status] = (counts[status] || 0) + 1;
  }
  return {
    total: findAllCandidateList(data).length,
    counts,
    metrics: data?.run?.status?.metrics || data?.status?.metrics
  };
}

function parseFindAllMatches(data: any): FindAllMatch[] {
  const mapped = findAllCandidateList(data)
    .filter((c: any) => {
      const status = String(c?.match_status || "");
      return status !== "unmatched" && status !== "discarded";
    })
    .map((c: any) => {
      const attributes: Record<string, any> = {};
      if (c.output && typeof c.output === "object") {
        for (const [key, value] of Object.entries(c.output)) {
          const parsed = outputFieldValue(value);
          if (parsed !== undefined && parsed !== null && parsed !== "") {
            attributes[key] = parsed;
          }
        }
      }
      if (c.attributes && typeof c.attributes === "object") {
        Object.assign(attributes, c.attributes);
      }
      return {
        name: c.name || "",
        url: c.url || "",
        description: c.description || "",
        matchStatus: String(c?.match_status || ""),
        attributes
      } as FindAllMatch;
    })
    .filter((m: FindAllMatch) => Boolean(m.name || m.url));

  const matched = mapped.filter((m) => !m.matchStatus || m.matchStatus === "matched");
  return matched.length > 0 ? matched : mapped;
}

function parseTaskOutput(data: any): string {
  const output = data?.output ?? data?.result ?? data;
  if (!output) return "";
  if (typeof output === "string") return output;
  if (typeof output.content === "string") return output.content;
  if (output.content && typeof output.content === "object") {
    return JSON.stringify(output.content, null, 2);
  }
  if (typeof output === "object") {
    const { type, basis, ...rest } = output;
    if (Object.keys(rest).length > 0) return JSON.stringify(rest, null, 2);
    return JSON.stringify(output, null, 2);
  }
  return String(output);
}

function summarizeExtractResult(result: ExtractResultItem | undefined): string {
  if (!result) return "";
  if (result.summary) return String(result.summary);
  if (Array.isArray(result.excerpts) && result.excerpts.length > 0) {
    return result.excerpts.join("\n\n").slice(0, 2000);
  }
  if (result.full_content) return String(result.full_content).slice(0, 2000);
  if (result.content) return String(result.content).slice(0, 2000);
  return "";
}

export class ParallelService {
  // ─────────────────────────────────────────────────────────────────────────
  // 1. FindAll: Ingest — turns an objective into a structured spec
  //    POST /v1beta/findall/ingest
  // ─────────────────────────────────────────────────────────────────────────
  static async findAllIngest(objective: string): Promise<FindAllIngestResponse> {
    logger.info({ objective: objective.slice(0, 100) }, "FindAll: ingesting objective into structured spec");
    return parallelFetch("/v1beta/findall/ingest", {
      method: "POST",
      body: JSON.stringify({ objective })
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 2. FindAll: Create Run — starts a full run with match conditions
  //    POST /v1beta/findall/runs
  // ─────────────────────────────────────────────────────────────────────────
  static async findAllCreate(
    objective: string,
    matchConditions: FindAllMatchCondition[] = [],
    matchLimit: number = 10,
    entityType: string = "companies",
    generator: "preview" | "base" | "core" | "pro" = "base"
  ): Promise<FindAllRunResponse> {
    logger.info({ objective: objective.slice(0, 100), matchLimit, generator }, "FindAll: creating run");

    const body: any = {
      objective,
      entity_type: entityType,
      match_limit: Math.max(5, matchLimit),
      generator
    };

    if (matchConditions.length > 0) {
      body.match_conditions = matchConditions;
    }

    const data = await parallelFetch("/v1beta/findall/runs", {
      method: "POST",
      body: JSON.stringify(body)
    });

    const id = extractId(data, "findall_id", "id", "run_id");
    return {
      id,
      findall_id: id,
      status: extractStatus(data) || "queued",
      is_active: isActiveStatus(data),
      objective,
      entity_type: entityType,
      matches: parseFindAllMatches(data)
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 3. FindAll: Poll Results
  //    GET /v1beta/findall/runs/{id}
  //    GET /v1beta/findall/runs/{id}/result
  // ─────────────────────────────────────────────────────────────────────────
  static async findAllPollResults(
    runId: string,
    maxWaitMs: number = 180_000,
    pollIntervalMs: number = 4_000
  ): Promise<FindAllResultResponse> {
    const deadline = Date.now() + maxWaitMs;
    logger.info({ runId, maxWaitMs }, "FindAll: polling for results");

    let latestMatches: FindAllMatch[] = [];
    let latestStatus = "running";
    let lastSnapshotLog = "";

    while (Date.now() < deadline) {
      const snapshot: any = await parallelFetch(`/v1beta/findall/runs/${runId}/result`, {
        method: "GET"
      });

      latestStatus = extractStatus(snapshot) || latestStatus;
      const snapshotMatches = parseFindAllMatches(snapshot);
      if (snapshotMatches.length > 0) {
        latestMatches = snapshotMatches;
      }
      const summary = summarizeFindAllCandidates(snapshot);
      const snapshotLog = `${latestStatus}:${summary.total}:${latestMatches.length}`;
      if (snapshotLog !== lastSnapshotLog) {
        logger.info({ runId, status: latestStatus, kept: latestMatches.length, ...summary }, "FindAll: candidate snapshot");
        lastSnapshotLog = snapshotLog;
      }

      if (latestStatus === "completed" || latestStatus === "cancelled") {
        logger.info(
          { runId, matchCount: latestMatches.length, status: latestStatus },
          "FindAll: run completed"
        );
        return { id: runId, status: latestStatus, matches: latestMatches };
      }

      if (latestStatus === "failed") {
        const error = snapshot?.error || snapshot?.run?.error || "unknown error";
        logger.warn({ runId, error }, "FindAll: run failed");
        if (latestMatches.length > 0) {
          return { id: runId, status: latestStatus, matches: latestMatches, error };
        }
        throw new Error(`FindAll run ${runId} failed: ${error}`);
      }

      if (!isActiveStatus(snapshot) && latestMatches.length > 0) {
        return { id: runId, status: latestStatus || "completed", matches: latestMatches };
      }

      logger.debug(
        { runId, status: latestStatus, matchCount: latestMatches.length },
        "FindAll: still running..."
      );
      await sleep(pollIntervalMs);
    }

    logger.warn(
      { runId, matchCount: latestMatches.length, status: latestStatus },
      "FindAll: wait ended with the matches collected so far"
    );
    return { id: runId, status: latestStatus || "running", matches: latestMatches };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 4. FindAll: Enrich matches with structured schema
  //    POST /v1beta/findall/runs/{id}/enrich
  // ─────────────────────────────────────────────────────────────────────────
  static async findAllEnrich(runId: string, customSchema?: any): Promise<any> {
    logger.info({ runId }, "FindAll: enriching results with structured schema");

    const defaultSchema = {
      type: "json",
      json_schema: {
        type: "object",
        properties: {
          ceo_name: {
            type: "string",
            description: "Name of the CEO or primary executive"
          },
          founding_year: {
            type: "string",
            description: "Year the company was founded"
          },
          company_size: {
            type: "string",
            description: "Estimated employee headcount range (e.g. 50-200)"
          },
          industry: {
            type: "string",
            description: "Primary industry vertical"
          },
          annual_revenue_estimate: {
            type: "string",
            description: "Estimated annual revenue"
          },
          primary_contact_role: {
            type: "string",
            description: "Most relevant buyer role (e.g. CTO, VP Operations)"
          },
          tech_stack_signals: {
            type: "string",
            description: "Key technology stack elements or software vendors used"
          },
          recent_news: {
            type: "string",
            description: "Recent notable events or funding signals"
          }
        },
        required: ["ceo_name", "founding_year"],
        additionalProperties: false
      }
    };

    return parallelFetch(`/v1beta/findall/runs/${runId}/enrich`, {
      method: "POST",
      body: JSON.stringify({
        processor: "lite",
        output_schema: customSchema || defaultSchema
      })
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 5. FindAll: Extend match limit
  //    POST /v1beta/findall/runs/{id}/extend
  // ─────────────────────────────────────────────────────────────────────────
  static async findAllExtend(
    runId: string,
    additionalLimit: number = 10
  ): Promise<FindAllRunResponse> {
    logger.info({ runId, additionalLimit }, "FindAll: extending match limit");

    const data = await parallelFetch(`/v1beta/findall/runs/${runId}/extend`, {
      method: "POST",
      body: JSON.stringify({ additional_match_limit: additionalLimit })
    });

    const id = extractId(data, "findall_id", "id") || runId;
    return {
      id,
      findall_id: id,
      status: extractStatus(data) || "queued",
      is_active: isActiveStatus(data),
      matches: parseFindAllMatches(data)
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 6. Fast Entity Search (low-latency first wave)
  //    POST /v1beta/findall/entity-search
  // ─────────────────────────────────────────────────────────────────────────
  static async entitySearch(
    objective: string,
    matchLimit: number = env.ENTITY_MATCH_LIMIT,
    options?: { fresh?: boolean }
  ): Promise<ParallelEntitySearchResponse> {
    const body = {
      entity_type: "companies",
      objective,
      match_limit: Math.max(5, Math.min(100, matchLimit))
    };

    const run = async () => {
      logger.info({ objective: objective.slice(0, 80), matchLimit: body.match_limit, fresh: Boolean(options?.fresh) }, "Parallel Entity Search (fast path)");

      const data: any = await parallelFetch("/v1beta/findall/entity-search", {
        method: "POST",
        body: JSON.stringify(body)
      });

      const rawEntities = data.entities || data.results || [];
      const entities: ParallelEntity[] = (Array.isArray(rawEntities) ? rawEntities : [])
        .map((entity: any) => ({
          name: String(entity?.name || entity?.title || "").trim(),
          url: String(entity?.url || entity?.website || entity?.homepage || "").trim(),
          description: String(entity?.description || "").trim()
        }))
        .filter((entity: ParallelEntity) => Boolean(entity.name || entity.url));

      return {
        entity_set_id: data.entity_set_id || "",
        entities
      };
    };

    if (options?.fresh) return run();
    return cached("parallel_entity", body, run);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 7. Full Discovery Flow — Ingest -> Create -> Poll -> Enrich
  // ─────────────────────────────────────────────────────────────────────────
  static async findAllDiscover(
    objective: string,
    matchConditions: FindAllMatchCondition[] = [],
    matchLimit: number = 10,
    doEnrich: boolean = true,
    maxWaitMs: number = 75_000
  ): Promise<{ runId: string; matches: FindAllMatch[] }> {
    let finalConditions = matchConditions;
    let entityType = "companies";

    if (finalConditions.length === 0) {
      try {
        const spec = await this.findAllIngest(objective);
        if (spec.match_conditions && spec.match_conditions.length > 0) {
          finalConditions = spec.match_conditions;
        }
        if (spec.entity_type) entityType = spec.entity_type;
      } catch (err) {
        logger.debug({ err }, "FindAll ingest skipped, proceeding with default conditions");
      }
    }

    const created = await this.findAllCreate(objective, finalConditions, matchLimit, entityType, "base");
    const runId = created.id;
    if (!runId) {
      throw new Error("FindAll create did not return a findall_id");
    }

    const result = await this.findAllPollResults(runId, maxWaitMs);
    let matches = result.matches || [];

    if (doEnrich && runId && matches.length > 0 && result.status !== "running" && result.status !== "queued") {
      try {
        await this.findAllEnrich(runId);
        const enriched = await this.findAllPollResults(runId, 45_000);
        if (enriched.matches && enriched.matches.length > 0) {
          matches = enriched.matches;
        }
      } catch (err) {
        logger.warn({ err, runId }, "FindAll enrich failed (non-fatal)");
      }
    }

    return { runId, matches };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 8. Search API: General Web Search
  //    POST /v1/search
  // ─────────────────────────────────────────────────────────────────────────
  static async search(
    objective: string,
    searchQueries: string[],
    countryCode: string = "in",
    sessionId: string = `search-${Date.now()}`
  ): Promise<ParallelSearchResponse> {
    const location = (countryCode || "in").toLowerCase();

    const sanitizedQueries = searchQueries
      .map((q) => q.replace(/site:[^\s]+/gi, "").trim())
      .filter(Boolean);

    const body = {
      objective,
      search_queries: sanitizedQueries.slice(0, 5),
      mode: env.PARALLEL_SEARCH_MODE || "fast",
      max_chars_total: 6000,
      session_id: sessionId,
      advanced_settings: {
        location,
        max_results: 3,
        source_policy: {
          exclude_domains: ["youtube.com", "facebook.com", "instagram.com", "pinterest.com"]
        }
      }
    };

    logger.info(
      { objective: objective.slice(0, 80), queriesCount: sanitizedQueries.length, location, sessionId },
      "Executing Parallel Web Search"
    );

    const data: any = await parallelFetch("/v1/search", {
      method: "POST",
      body: JSON.stringify(body)
    });

    return {
      search_id: data.search_id || "",
      results: data.results || [],
      session_id: data.session_id || sessionId
    };
  }

  static async enrichCompany(
    objective: string,
    searchQueries: string[],
    countryCode: string,
    sessionId: string
  ): Promise<ParallelSearchResponse> {
    return this.search(objective, searchQueries, countryCode, sessionId);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 9. Extract API: Pull structured content from specific URLs
  //    POST /v1/extract
  // ─────────────────────────────────────────────────────────────────────────
  static async extract(
    urls: string[],
    objective: string = "Summarize company offering and target audience"
  ): Promise<ExtractResponse> {
    const usableUrls = urls.filter(Boolean).slice(0, 10);
    if (usableUrls.length === 0) {
      return { results: [] };
    }

    logger.info({ urlsCount: usableUrls.length, objective: objective.slice(0, 80) }, "Parallel Extract API");
    const data = await parallelFetch("/v1/extract", {
      method: "POST",
      body: JSON.stringify({ urls: usableUrls, objective })
    });

    const results = (data.results || []).map((item: any) => ({
      ...item,
      summary: summarizeExtractResult(item)
    }));

    return { ...data, results };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 10. Task API: Deep research on a single lead or topic
  //     POST /v1/tasks/runs
  //     GET  /v1/tasks/runs/{run_id}
  //     GET  /v1/tasks/runs/{run_id}/result
  // ─────────────────────────────────────────────────────────────────────────
  static async taskRun(
    objective: string,
    urls: string[] = [],
    processor: "lite" | "base" | "core" | "pro" = "lite"
  ): Promise<TaskRunResponse> {
    const input = urls.length > 0
      ? `${objective}\n\nUse these source URLs as primary context: ${urls.join(", ")}`
      : objective;

    logger.info({ objective: input.slice(0, 80), processor }, "Parallel Task API: running research task");

    const created = await parallelFetch("/v1/tasks/runs", {
      method: "POST",
      body: JSON.stringify({
        processor,
        input,
        task_spec: {
          output_schema: {
            type: "text",
            description:
              "A concise research brief covering workflow pain points, modernization initiatives, buying signals, and a recommended outreach angle."
          }
        }
      })
    });

    const runId = extractId(created, "run_id", "id");
    if (!runId) {
      throw new Error("Task API did not return a run_id");
    }

    const result = await this.taskPollResult(runId, 90_000);
    return {
      id: runId,
      status: result.status,
      output: result.output,
      result: result.result,
      error: result.error
    };
  }

  static async taskPollResult(
    runId: string,
    maxWaitMs: number = 90_000,
    pollIntervalMs: number = 3_000
  ): Promise<TaskRunResponse> {
    const deadline = Date.now() + maxWaitMs;

    while (Date.now() < deadline) {
      const statusPayload: any = await parallelFetch(`/v1/tasks/runs/${runId}`, { method: "GET" });
      const status = extractStatus(statusPayload) || statusPayload?.status || "";

      if (status === "completed") {
        const resultPayload: any = await parallelFetch(`/v1/tasks/runs/${runId}/result`, {
          method: "GET"
        });
        return {
          id: runId,
          status,
          output: parseTaskOutput(resultPayload),
          result: resultPayload
        };
      }

      if (status === "failed" || status === "cancelled") {
        const error = statusPayload?.error || statusPayload?.error_message || `Task ${status}`;
        throw new Error(error);
      }

      await sleep(pollIntervalMs);
    }

    throw new Error(`Task run ${runId} timed out after ${maxWaitMs}ms`);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 11. Task API: Batch research
  //     POST /v1/tasks/groups
  //     POST /v1/tasks/groups/{taskgroup_id}/runs
  // ─────────────────────────────────────────────────────────────────────────
  static async taskGroupRun(
    tasks: Array<{ objective: string; sources?: string[] }>
  ): Promise<any> {
    logger.info({ tasksCount: tasks.length }, "Parallel Task Group API: running batch research");

    const group = await parallelFetch("/v1/tasks/groups", {
      method: "POST",
      body: JSON.stringify({})
    });

    const taskgroupId = extractId(group, "taskgroup_id", "id");
    const runs = tasks.map((task) => ({
      processor: "lite",
      input: task.sources?.length
        ? `${task.objective}\n\nUse these source URLs as primary context: ${task.sources.join(", ")}`
        : task.objective
    }));

    if (taskgroupId) {
      return parallelFetch(`/v1/tasks/groups/${taskgroupId}/runs`, {
        method: "POST",
        body: JSON.stringify({ runs })
      });
    }

    return parallelFetch("/v1/tasks/groups", {
      method: "POST",
      body: JSON.stringify({ default_task_spec: {}, runs })
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 12. Monitor API: Track leads over time (funding news, hiring, changes)
  //     POST /v1/monitors
  // ─────────────────────────────────────────────────────────────────────────
  static async createMonitor(
    query: string,
    schedule: "daily" | "weekly" = "weekly"
  ): Promise<MonitorResponse> {
    const frequency = schedule === "daily" ? "1d" : "7d";
    logger.info({ query, frequency }, "Parallel Monitor API: creating lead monitor");

    const data = await parallelFetch("/v1/monitors", {
      method: "POST",
      body: JSON.stringify({
        type: "event_stream",
        frequency,
        processor: "lite",
        settings: { query }
      })
    });

    const id = extractId(data, "monitor_id", "id");
    return {
      ...data,
      id,
      monitor_id: id,
      status: extractStatus(data) || data.status || "active",
      query,
      schedule
    };
  }

  static async ping(): Promise<boolean> {
    if (!env.PARALLEL_API_KEY) return false;
    try {
      await this.entitySearch("technology companies", 5);
      return true;
    } catch (err) {
      logger.warn({ err }, "Parallel API ping failed");
      return false;
    }
  }
}
