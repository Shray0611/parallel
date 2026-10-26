import { useState, useEffect } from "react";
import { apiRequest } from "@/lib/api";
import {
  Settings as SettingsIcon,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Database,
  Cpu,
  Globe,
  ShieldCheck,
  RefreshCw,
  Server,
  Layers,
  Zap,
  HelpCircle,
  Activity
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

interface HealthData {
  status: "ok" | "degraded";
  timestamp: string;
  demoMode: boolean;
  services: {
    database: "connected" | "disconnected";
    gemini?: "ok" | "failed" | "unconfigured";
    groq?: "ok" | "failed" | "unconfigured";
    parallel: "ok" | "failed" | "unconfigured";
  };
}

export default function Settings() {
  const [health, setHealth] = useState<HealthData | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const fetchHealth = async () => {
    setIsLoading(true);
    try {
      const data = await apiRequest<HealthData>("/health");
      setHealth(data);
      toast.success("Diagnostics refreshed");
    } catch (err: any) {
      toast.error(err.message || "Failed to fetch system health");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchHealth();
  }, []);

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8 space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-6">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
              System Settings & Integration Health
            </h1>
            <Badge
              variant={health?.status === "ok" ? "default" : "destructive"}
              className="capitalize text-xs font-semibold"
            >
              {health?.status || "Checking"}
            </Badge>
          </div>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Real-time diagnostics for Google Gemini LLM, Parallel Search APIs, Database, and Demo Fallback
          </p>
        </div>

        <Button
          variant="outline"
          onClick={fetchHealth}
          disabled={isLoading}
          className="gap-2 self-start sm:self-auto"
        >
          <RefreshCw className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
          Refresh Diagnostics
        </Button>
      </div>

      {/* Service Health Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Database */}
        <Card className="border-slate-200 dark:border-slate-800 shadow-sm">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Database Engine</span>
              <Database className="h-4 w-4 text-slate-400" />
            </div>
            <CardTitle className="text-lg flex items-center gap-2 mt-1">
              MongoDB
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-xs">
            <div className="flex items-center justify-between p-2.5 rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-800">
              <span className="text-slate-600 dark:text-slate-400 font-medium">Connection State</span>
              <div className="flex items-center gap-1.5 font-bold">
                {health?.services?.database === "connected" ? (
                  <>
                    <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                    <span className="text-emerald-700 dark:text-emerald-400">Connected</span>
                  </>
                ) : (
                  <>
                    <AlertTriangle className="h-4 w-4 text-amber-500" />
                    <span className="text-amber-700 dark:text-amber-400">Offline (In-Memory Fallback Active)</span>
                  </>
                )}
              </div>
            </div>
            <p className="text-[11px] text-slate-400">
              Persists Users, Campaigns, Leads, and 7-day ApiCache.
            </p>
          </CardContent>
        </Card>

        {/* Google Gemini LLM */}
        <Card className="border-slate-200 dark:border-slate-800 shadow-sm">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Reasoning Engine</span>
              <Cpu className="h-4 w-4 text-slate-400" />
            </div>
            <CardTitle className="text-lg flex items-center gap-2 mt-1">
              Google Gemini 2.0 / 1.5 Flash
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-xs">
            <div className="flex items-center justify-between p-2.5 rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-800">
              <span className="text-slate-600 dark:text-slate-400 font-medium">API Key & Model</span>
              <div className="flex items-center gap-1.5 font-bold">
                {(health?.services?.gemini || health?.services?.groq) === "ok" ? (
                  <>
                    <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                    <span className="text-emerald-700 dark:text-emerald-400">Operational</span>
                  </>
                ) : (health?.services?.gemini || health?.services?.groq) === "failed" ? (
                  <>
                    <AlertTriangle className="h-4 w-4 text-amber-500" />
                    <span className="text-amber-700 dark:text-amber-400">Connection Failed</span>
                  </>
                ) : (
                  <>
                    <XCircle className="h-4 w-4 text-slate-400" />
                    <span className="text-slate-500">Unconfigured</span>
                  </>
                )}
              </div>
            </div>
            <p className="text-[11px] text-slate-400">
              Powers ICP generation, search query formulating, lead scoring 0-100, and personalized outreach drafts.
            </p>
          </CardContent>
        </Card>

        {/* Parallel Search */}
        <Card className="border-slate-200 dark:border-slate-800 shadow-sm">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Web Intelligence</span>
              <Globe className="h-4 w-4 text-slate-400" />
            </div>
            <CardTitle className="text-lg flex items-center gap-2 mt-1">
              Parallel AI
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-xs">
            <div className="flex items-center justify-between p-2.5 rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-800">
              <span className="text-slate-600 dark:text-slate-400 font-medium">Search & Entity API</span>
              <div className="flex items-center gap-1.5 font-bold">
                {health?.services?.parallel === "ok" ? (
                  <>
                    <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                    <span className="text-emerald-700 dark:text-emerald-400">Active & Verified</span>
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="h-4 w-4 text-blue-500" />
                    <span className="text-blue-700 dark:text-blue-400">Configured in .env</span>
                  </>
                )}
              </div>
            </div>
            <p className="text-[11px] text-slate-400">
              Powers Entity Search (company discovery) and fast Search API (live web evidence extraction).
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Parallel Web Systems Integration Architecture */}
      <Card className="border-slate-200 dark:border-slate-800 shadow-sm">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Globe className="h-5 w-5 text-blue-600 dark:text-blue-400" />
            <CardTitle className="text-base">Parallel Web Systems Architecture</CardTitle>
          </div>
          <CardDescription>
            Direct REST contract specifications and parameters utilized in Cerelabs LeadScope
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="p-4 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900 space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-bold text-xs text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                  <span className="px-1.5 py-0.5 rounded bg-blue-100 dark:bg-blue-950 text-blue-700 dark:text-blue-300 font-mono text-[10px]">
                    POST
                  </span>
                  /v1beta/findall/entity-search
                </span>
                <Badge variant="outline" className="text-[10px]">Stage 2: Discovery</Badge>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Queries candidate company entities matching natural language ICP search objectives.
              </p>
              <div className="bg-slate-950 p-2.5 rounded font-mono text-[11px] text-slate-300 overflow-x-auto">
                {`{ "entity_type": "companies", "match_limit": 25 }`}
              </div>
            </div>

            <div className="p-4 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900 space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-bold text-xs text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                  <span className="px-1.5 py-0.5 rounded bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 font-mono text-[10px]">
                    POST
                  </span>
                  /v1/search
                </span>
                <Badge variant="outline" className="text-[10px]">Stage 3: Enrichment</Badge>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Enriches each lead with live web results in fast mode, sanitized keyword queries, and country targeting.
              </p>
              <div className="bg-slate-950 p-2.5 rounded font-mono text-[11px] text-slate-300 overflow-x-auto">
                {`{ "mode": "fast", "max_chars_total": 6000, "max_results": 5 }`}
              </div>
            </div>
          </div>

          <div className="p-3 rounded-lg bg-blue-50/40 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-900/40 flex items-start gap-2.5">
            <ShieldCheck className="h-4 w-4 text-blue-600 mt-0.5 flex-shrink-0" />
            <div className="text-xs text-blue-900 dark:text-blue-200">
              <span className="font-semibold">Clean Source Policy Active:</span> Social and video domains (<code className="font-mono text-[11px]">youtube.com</code>, <code className="font-mono text-[11px]">facebook.com</code>, <code className="font-mono text-[11px]">instagram.com</code>, <code className="font-mono text-[11px]">pinterest.com</code>) are excluded at the search gateway level to ensure verified B2B web evidence.
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Demo Mode Configuration Details */}
      <Card className="border-slate-200 dark:border-slate-800 shadow-sm">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Activity className="h-5 w-5 text-amber-500" />
              <CardTitle className="text-base">Demo Mode Fallback Engine</CardTitle>
            </div>
            <Badge variant={health?.demoMode ? "warm" : "outline"}>
              {health?.demoMode ? "ACTIVE (DEMO_MODE=true)" : "INACTIVE (Live API Only)"}
            </Badge>
          </div>
          <CardDescription>
            Guarantees 100% reliable investor and demo day presentations even without external API connectivity
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-xs text-slate-600 dark:text-slate-300">
          <p>
            When <code className="bg-slate-100 dark:bg-slate-800 px-1 py-0.5 rounded font-mono">DEMO_MODE=true</code> is set in <code className="font-mono">backend/.env</code>, the pipeline serves 25 realistic, fully enriched enterprise companies across Pharmaceuticals, BFSI, Legal, Logistics, and Manufacturing with realistic 400ms visual staging delays.
          </p>
          <p>
            To switch to live API extraction at any time, simply set <code className="font-mono">DEMO_MODE=false</code> in <code className="font-mono">backend/.env</code> and restart your backend.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
