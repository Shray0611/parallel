import React, { useEffect, useState, useMemo } from "react";
import { useParams, Link } from "react-router-dom";
import { toast } from "sonner";
import { apiRequest } from "@/lib/api";
import { Campaign, Lead } from "@/types/campaign";
import {
  Sparkles,
  ArrowLeft,
  Download,
  Search,
  Filter,
  CheckCircle2,
  Clock,
  ExternalLink,
  ChevronRight,
  X,
  Mail,
  Copy,
  Check,
  RefreshCw,
  Building,
  Target,
  Zap,
  Flame,
  Activity,
  Layers,
  FileText,
  AlertCircle
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

export default function CampaignDetail() {
  const { id } = useParams<{ id: string }>();
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [eventLogs, setEventLogs] = useState<Array<{ time: string; msg: string; stage?: string }>>([]);
  const [showLogs, setShowLogs] = useState(false);

  // Filters & Sorting
  const [searchTerm, setSearchTerm] = useState("");
  const [tierFilter, setTierFilter] = useState<"all" | "hot" | "warm" | "cold">("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [industryFilter, setIndustryFilter] = useState<string>("all");
  const [sortBy, setSortBy] = useState<"score_desc" | "score_asc" | "name">("score_desc");

  // Lead Slide-Over State
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [notesText, setNotesText] = useState("");

  // Initial Load
  const fetchCampaign = async () => {
    try {
      const res = await apiRequest<{ campaign: Campaign }>(`/campaigns/${id}`);
      setCampaign(res.campaign);
    } catch (err: any) {
      toast.error(err.message || "Failed to load campaign");
    }
  };

  const fetchLeads = async () => {
    try {
      const res = await apiRequest<{ leads: Lead[] }>(`/campaigns/${id}/leads?limit=100`);
      setLeads(res.leads);
      setIsLoading(false);
    } catch (err: any) {
      toast.error(err.message || "Failed to load leads");
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchCampaign();
    fetchLeads();
  }, [id]);

  // Server-Sent Events (SSE) Live Progress Listener
  useEffect(() => {
    if (!id) return;

    const API_URL = import.meta.env.VITE_API_URL || "http://localhost:4000";
    const eventSource = new EventSource(`${API_URL}/api/campaigns/${id}/events`);

    eventSource.addEventListener("progress", (e) => {
      try {
        const data = JSON.parse(e.data);
        setCampaign((prev) => {
          if (!prev) return null;
          return {
            ...prev,
            status: "running",
            progress: {
              stage: data.stage,
              current: data.current,
              total: data.total,
              message: data.message
            }
          };
        });
        setEventLogs((prev) => [
          { time: new Date().toLocaleTimeString(), msg: data.message, stage: data.stage },
          ...prev.slice(0, 49)
        ]);
      } catch (err) {
        console.error("SSE parse error", err);
      }
    });

    eventSource.addEventListener("lead_added", (e) => {
      try {
        const data = JSON.parse(e.data);
        setLeads((prev) => {
          const exists = prev.some((l) => (l._id || l.id) === (data.lead._id || data.lead.id));
          if (exists) return prev;
          return [data.lead, ...prev];
        });
      } catch (err) {
        console.error("SSE lead_added parse error", err);
      }
    });

    eventSource.addEventListener("lead_scored", (e) => {
      try {
        const data = JSON.parse(e.data);
        setLeads((prev) =>
          prev.map((l) =>
            (l._id || l.id) === (data.lead._id || data.lead.id) ? data.lead : l
          )
        );
      } catch (err) {
        console.error("SSE lead_scored parse error", err);
      }
    });

    eventSource.addEventListener("done", (e) => {
      try {
        const data = JSON.parse(e.data);
        toast.success("Discovery and AI scoring completed!");
        setCampaign((prev) => {
          if (!prev) return null;
          return {
            ...prev,
            status: "completed",
            stats: data.stats || prev.stats,
            progress: {
              ...prev.progress,
              stage: "completed",
              message: "Pipeline completed successfully"
            }
          };
        });
        fetchLeads();
      } catch (err) {
        console.error("SSE done parse error", err);
      }
    });

    eventSource.onerror = () => {
      // EventSource reconnects automatically
    };

    return () => {
      eventSource.close();
    };
  }, [id]);

  // Synchronize lead notes when selection changes
  useEffect(() => {
    if (selectedLead) {
      setNotesText(selectedLead.notes || "");
    }
  }, [selectedLead]);

  // Update lead status
  const handleStatusChange = async (leadId: string, newStatus: Lead["status"]) => {
    try {
      await apiRequest(`/leads/${leadId}`, {
        method: "PATCH",
        body: JSON.stringify({ status: newStatus })
      });
      setLeads((prev) =>
        prev.map((l) => ((l._id || l.id) === leadId ? { ...l, status: newStatus } : l))
      );
      if (selectedLead && (selectedLead._id || selectedLead.id) === leadId) {
        setSelectedLead({ ...selectedLead, status: newStatus });
      }
      toast.success(`Marked as ${newStatus}`);
    } catch (err: any) {
      toast.error(err.message || "Failed to update lead status");
    }
  };

  // Auto-save lead notes
  const handleSaveNotes = async () => {
    if (!selectedLead) return;
    const leadId = selectedLead._id || selectedLead.id;
    try {
      await apiRequest(`/leads/${leadId}`, {
        method: "PATCH",
        body: JSON.stringify({ notes: notesText })
      });
      setLeads((prev) =>
        prev.map((l) => ((l._id || l.id) === leadId ? { ...l, notes: notesText } : l))
      );
      toast.success("Notes saved");
    } catch (err: any) {
      toast.error(err.message || "Failed to save notes");
    }
  };

  // Regenerate outreach with specific tone
  const handleRegenerateOutreach = async (tone: "formal" | "friendly" | "short") => {
    if (!selectedLead) return;
    const leadId = selectedLead._id || selectedLead.id;
    setIsRegenerating(true);

    try {
      const res = await apiRequest<{ outreach: Lead["outreach"] }>(
        `/leads/${leadId}/regenerate-outreach`,
        {
          method: "POST",
          body: JSON.stringify({ tone })
        }
      );

      setSelectedLead({ ...selectedLead, outreach: res.outreach });
      setLeads((prev) =>
        prev.map((l) => ((l._id || l.id) === leadId ? { ...l, outreach: res.outreach } : l))
      );
      toast.success(`Regenerated outreach (${tone} tone)`);
    } catch (err: any) {
      toast.error(err.message || "Failed to regenerate outreach");
    } finally {
      setIsRegenerating(false);
    }
  };

  // Copy helper
  const copyToClipboard = (text: string, field: string) => {
    navigator.clipboard.writeText(text);
    setCopiedField(field);
    toast.success("Copied to clipboard!");
    setTimeout(() => setCopiedField(null), 2000);
  };

  // Export CSV
  const handleExportCsv = () => {
    const API_URL = import.meta.env.VITE_API_URL || "http://localhost:4000";
    window.open(`${API_URL}/api/campaigns/${id}/export.csv`, "_blank");
    toast.info("Downloading leads CSV export...");
  };

  // Derived Filtered and Sorted Leads
  const filteredLeads = useMemo(() => {
    return leads
      .filter((lead) => {
        if (tierFilter !== "all" && lead.score?.tier !== tierFilter) return false;
        if (statusFilter !== "all" && lead.status !== statusFilter) return false;
        if (industryFilter !== "all" && lead.score?.industry !== industryFilter) return false;
        if (searchTerm.trim()) {
          const q = searchTerm.toLowerCase();
          const matchName = lead.name.toLowerCase().includes(q);
          const matchDomain = lead.domain.toLowerCase().includes(q);
          const matchDesc = lead.description?.toLowerCase().includes(q);
          if (!matchName && !matchDomain && !matchDesc) return false;
        }
        return true;
      })
      .sort((a, b) => {
        if (sortBy === "score_desc") return (b.score?.total || 0) - (a.score?.total || 0);
        if (sortBy === "score_asc") return (a.score?.total || 0) - (b.score?.total || 0);
        if (sortBy === "name") return a.name.localeCompare(b.name);
        return 0;
      });
  }, [leads, tierFilter, statusFilter, industryFilter, searchTerm, sortBy]);

  const uniqueIndustries = useMemo(() => {
    const set = new Set<string>();
    leads.forEach((l) => {
      if (l.score?.industry) set.add(l.score.industry);
    });
    return Array.from(set);
  }, [leads]);

  // Stepper Stage Helper
  const stages = [
    { key: "icp", label: "1. ICP Strategy" },
    { key: "discover", label: "2. Entity Search" },
    { key: "enrich", label: "3. Web Enrichment" },
    { key: "score", label: "4. AI Scoring" },
    { key: "completed", label: "5. Completed" }
  ];

  const currentStageIndex = useMemo(() => {
    if (!campaign) return 0;
    if (campaign.status === "completed") return 4;
    const stage = campaign.progress?.stage || "icp";
    return stages.findIndex((s) => s.key === stage);
  }, [campaign]);

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8 space-y-6">
      {/* Top Navigation */}
      <div className="flex items-center gap-2 text-sm text-slate-500">
        <Link to="/" className="hover:text-blue-600 flex items-center gap-1">
          <ArrowLeft className="h-4 w-4" />
          Dashboard
        </Link>
        <span>/</span>
        <span className="font-medium text-slate-900 dark:text-slate-100">
          {campaign?.title || "Campaign Details"}
        </span>
      </div>

      {/* Campaign Header & Status */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-6">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
              {campaign?.title}
            </h1>
            <Badge
              variant={
                campaign?.status === "completed"
                  ? "default"
                  : campaign?.status === "running"
                  ? "warm"
                  : "outline"
              }
              className="capitalize"
            >
              {campaign?.status === "running" && (
                <span className="h-1.5 w-1.5 rounded-full bg-amber-500 animate-pulse mr-1.5" />
              )}
              {campaign?.status || "draft"}
            </Badge>
          </div>
          <p className="text-sm text-slate-600 dark:text-slate-400 mt-1 max-w-2xl line-clamp-2">
            {campaign?.offering}
          </p>
          <div className="flex flex-wrap items-center gap-2 mt-3 text-xs">
            <Badge variant="outline">{campaign?.filters?.country} Market</Badge>
            <Badge variant="outline">{campaign?.filters?.companySize} Employees</Badge>
            {campaign?.filters?.domains?.map((d) => (
              <Badge key={d} variant="secondary">{d}</Badge>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-3">
          <Button variant="outline" onClick={handleExportCsv} className="gap-2">
            <Download className="h-4 w-4" />
            Export CSV
          </Button>
          <Button
            variant="ghost"
            onClick={() => setShowLogs(!showLogs)}
            className="text-xs text-slate-500 hover:text-slate-900 dark:hover:text-slate-100"
          >
            <Activity className="h-4 w-4 mr-1 text-blue-500" />
            {showLogs ? "Hide Logs" : `Logs (${eventLogs.length})`}
          </Button>
        </div>
      </div>

      {/* Live Pipeline Stepper */}
      <Card className="border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
        <div className="p-4 bg-slate-50 dark:bg-slate-900/60 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-blue-600 dark:text-blue-400" />
            <span className="text-sm font-semibold">Live Intelligence Pipeline</span>
          </div>
          <span className="text-xs text-slate-500 dark:text-slate-400">
            {campaign?.progress?.message || "Pipeline inactive"}
          </span>
        </div>

        <div className="p-4">
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
            {stages.map((stg, idx) => {
              const isPast = idx < currentStageIndex || campaign?.status === "completed";
              const isCurrent = idx === currentStageIndex && campaign?.status === "running";
              return (
                <div
                  key={stg.key}
                  className={`flex items-center gap-2 p-2.5 rounded-lg border text-xs font-medium transition-all ${
                    isPast
                      ? "border-emerald-200 bg-emerald-50/60 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300"
                      : isCurrent
                      ? "border-blue-600 bg-blue-50/80 text-blue-700 dark:border-blue-700 dark:bg-blue-950/60 dark:text-blue-300 animate-pulse"
                      : "border-slate-200 text-slate-400 dark:border-slate-800"
                  }`}
                >
                  {isPast ? (
                    <CheckCircle2 className="h-4 w-4 text-emerald-600 flex-shrink-0" />
                  ) : isCurrent ? (
                    <Clock className="h-4 w-4 text-blue-600 animate-spin flex-shrink-0" />
                  ) : (
                    <span className="h-4 w-4 rounded-full border border-current flex items-center justify-center text-[10px] flex-shrink-0">
                      {idx + 1}
                    </span>
                  )}
                  <span className="truncate">{stg.label}</span>
                </div>
              );
            })}
          </div>

          {/* Event Logs Drawer */}
          {showLogs && (
            <div className="mt-4 p-3 rounded-lg bg-slate-950 text-slate-200 font-mono text-xs max-h-48 overflow-y-auto space-y-1">
              <div className="text-[11px] text-slate-400 font-bold uppercase tracking-wider mb-2">
                SSE Live Stream Log
              </div>
              {eventLogs.length === 0 ? (
                <div className="text-slate-500">Waiting for live pipeline events...</div>
              ) : (
                eventLogs.map((log, i) => (
                  <div key={i} className="flex gap-2 text-[11px]">
                    <span className="text-slate-500">[{log.time}]</span>
                    {log.stage && <span className="text-blue-400 uppercase">[{log.stage}]</span>}
                    <span>{log.msg}</span>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </Card>

      {/* KPI Stats Counters */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <div className="p-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
          <span className="text-xs text-slate-500">Found Leads</span>
          <div className="text-xl font-bold mt-1 text-slate-900 dark:text-slate-100">
            {campaign?.stats?.found || leads.length}
          </div>
        </div>

        <div className="p-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
          <span className="text-xs text-slate-500">Enriched</span>
          <div className="text-xl font-bold mt-1 text-slate-900 dark:text-slate-100">
            {campaign?.stats?.enriched || leads.filter((l) => l.enrichment).length}
          </div>
        </div>

        <div className="p-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
          <span className="text-xs text-slate-500">Scored</span>
          <div className="text-xl font-bold mt-1 text-slate-900 dark:text-slate-100">
            {campaign?.stats?.scored || leads.filter((l) => l.score).length}
          </div>
        </div>

        <div className="p-3 rounded-lg border border-red-200 bg-red-50/40 dark:border-red-950 dark:bg-red-950/20">
          <span className="text-xs text-red-600 font-medium flex items-center gap-1">
            <Flame className="h-3 w-3" />
            Hot (≥70)
          </span>
          <div className="text-xl font-bold mt-1 text-red-700 dark:text-red-400">
            {campaign?.stats?.hot || leads.filter((l) => l.score?.tier === "hot").length}
          </div>
        </div>

        <div className="p-3 rounded-lg border border-amber-200 bg-amber-50/40 dark:border-amber-950 dark:bg-amber-950/20">
          <span className="text-xs text-amber-600 font-medium flex items-center gap-1">
            <Zap className="h-3 w-3" />
            Warm (45-69)
          </span>
          <div className="text-xl font-bold mt-1 text-amber-700 dark:text-amber-400">
            {campaign?.stats?.warm || leads.filter((l) => l.score?.tier === "warm").length}
          </div>
        </div>

        <div className="p-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
          <span className="text-xs text-slate-500">Cold (&lt;45)</span>
          <div className="text-xl font-bold mt-1 text-slate-500">
            {campaign?.stats?.cold || leads.filter((l) => l.score?.tier === "cold").length}
          </div>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm">
        <div className="flex items-center gap-2 flex-1 max-w-md">
          <Search className="h-4 w-4 text-slate-400" />
          <Input
            placeholder="Search companies, domains, or descriptions..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="h-8 text-xs"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Tier Filter */}
          <select
            value={tierFilter}
            onChange={(e) => setTierFilter(e.target.value as any)}
            className="h-8 rounded-md border border-slate-200 bg-transparent px-2.5 text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-blue-600 dark:border-slate-800 dark:bg-slate-900"
          >
            <option value="all">All Tiers</option>
            <option value="hot">Hot Only</option>
            <option value="warm">Warm Only</option>
            <option value="cold">Cold Only</option>
          </select>

          {/* Status Filter */}
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="h-8 rounded-md border border-slate-200 bg-transparent px-2.5 text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-blue-600 dark:border-slate-800 dark:bg-slate-900"
          >
            <option value="all">All Statuses</option>
            <option value="new">New</option>
            <option value="contacted">Contacted</option>
            <option value="replied">Replied</option>
            <option value="qualified">Qualified</option>
            <option value="lost">Lost</option>
          </select>

          {/* Industry Filter */}
          {uniqueIndustries.length > 0 && (
            <select
              value={industryFilter}
              onChange={(e) => setIndustryFilter(e.target.value)}
              className="h-8 rounded-md border border-slate-200 bg-transparent px-2.5 text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-blue-600 dark:border-slate-800 dark:bg-slate-900"
            >
              <option value="all">All Industries</option>
              {uniqueIndustries.map((ind) => (
                <option key={ind} value={ind}>{ind}</option>
              ))}
            </select>
          )}

          {/* Sort By */}
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as any)}
            className="h-8 rounded-md border border-slate-200 bg-transparent px-2.5 text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-blue-600 dark:border-slate-800 dark:bg-slate-900"
          >
            <option value="score_desc">Highest Score</option>
            <option value="score_asc">Lowest Score</option>
            <option value="name">Company Name</option>
          </select>
        </div>
      </div>

      {/* Leads Table */}
      <Card className="border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-800 text-xs text-slate-500 uppercase tracking-wider font-semibold">
              <tr>
                <th className="px-6 py-3">Company</th>
                <th className="px-4 py-3">Industry / Size</th>
                <th className="px-4 py-3">Score</th>
                <th className="px-4 py-3">Why Now Signal</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800 bg-white dark:bg-slate-900">
              {isLoading ? (
                <tr>
                  <td colSpan={6} className="text-center py-12 text-slate-500">
                    <Clock className="h-6 w-6 animate-spin mx-auto mb-2 text-blue-600" />
                    Loading leads...
                  </td>
                </tr>
              ) : filteredLeads.length === 0 ? (
                <tr>
                  <td colSpan={6} className="text-center py-12 text-slate-500">
                    No leads match your active filters.
                  </td>
                </tr>
              ) : (
                filteredLeads.map((lead) => {
                  const leadId = lead._id || lead.id || "";
                  const totalScore = lead.score?.total || 0;
                  const tier = lead.score?.tier || (totalScore >= 70 ? "hot" : totalScore >= 45 ? "warm" : "cold");

                  return (
                    <tr
                      key={leadId}
                      className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition-colors cursor-pointer"
                      onClick={() => setSelectedLead(lead)}
                    >
                      {/* Company Name & Favicon */}
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <img
                            src={`https://www.google.com/s2/favicons?domain=${lead.domain}&sz=32`}
                            alt=""
                            className="h-6 w-6 rounded bg-slate-100 dark:bg-slate-800 p-0.5 object-contain flex-shrink-0"
                            onError={(e) => {
                              (e.target as HTMLImageElement).src =
                                "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='16' height='16' fill='%2394a3b8'><rect width='16' height='16' rx='4'/></svg>";
                            }}
                          />
                          <div>
                            <div className="font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                              {lead.name}
                              {lead.website && (
                                <a
                                  href={lead.website.startsWith("http") ? lead.website : `https://${lead.website}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  onClick={(e) => e.stopPropagation()}
                                  className="text-slate-400 hover:text-blue-600 inline-block"
                                >
                                  <ExternalLink className="h-3 w-3" />
                                </a>
                              )}
                            </div>
                            <span className="text-xs text-slate-400">{lead.domain}</span>
                          </div>
                        </div>
                      </td>

                      {/* Industry & Size */}
                      <td className="px-4 py-4 text-xs">
                        <div className="font-medium text-slate-800 dark:text-slate-200">
                          {lead.score?.industry || "Enterprise"}
                        </div>
                        <div className="text-slate-400 mt-0.5">
                          {lead.score?.estimatedSize || campaign?.filters?.companySize || "Mid-Market"} •{" "}
                          {lead.score?.location || campaign?.filters?.country}
                        </div>
                      </td>

                      {/* Score Pill */}
                      <td className="px-4 py-4">
                        <div className="flex items-center gap-2">
                          <div
                            className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold text-white ${
                              tier === "hot"
                                ? "bg-red-600"
                                : tier === "warm"
                                ? "bg-amber-500"
                                : "bg-slate-500"
                            }`}
                          >
                            {totalScore}
                          </div>
                          <Badge variant={tier as any} className="capitalize text-[11px]">
                            {tier}
                          </Badge>
                        </div>
                      </td>

                      {/* Why Now */}
                      <td className="px-4 py-4 text-xs text-slate-600 dark:text-slate-300 max-w-xs line-clamp-2">
                        {lead.score?.whyNow || lead.description || "Active enterprise modernization"}
                      </td>

                      {/* Status */}
                      <td className="px-4 py-4" onClick={(e) => e.stopPropagation()}>
                        <select
                          value={lead.status}
                          onChange={(e) => handleStatusChange(leadId, e.target.value as any)}
                          className="h-7 rounded border border-slate-200 bg-white px-2 text-xs font-medium focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-blue-600 dark:border-slate-800 dark:bg-slate-900"
                        >
                          <option value="new">New</option>
                          <option value="contacted">Contacted</option>
                          <option value="replied">Replied</option>
                          <option value="qualified">Qualified</option>
                          <option value="lost">Lost</option>
                        </select>
                      </td>

                      {/* Action */}
                      <td className="px-4 py-4 text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedLead(lead);
                          }}
                          className="text-xs text-blue-600 hover:text-blue-700 dark:text-blue-400"
                        >
                          Details
                          <ChevronRight className="h-3 w-3 ml-1" />
                        </Button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Slide-over Lead Detail Drawer */}
      {selectedLead && (
        <div className="fixed inset-0 z-50 overflow-hidden bg-slate-900/50 backdrop-blur-xs flex justify-end">
          <div className="w-full max-w-2xl bg-white dark:bg-slate-900 h-full shadow-2xl flex flex-col border-l border-slate-200 dark:border-slate-800 overflow-y-auto">
            {/* Drawer Header */}
            <div className="sticky top-0 z-10 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 p-6 flex items-start justify-between">
              <div className="flex items-center gap-3">
                <img
                  src={`https://www.google.com/s2/favicons?domain=${selectedLead.domain}&sz=32`}
                  alt=""
                  className="h-8 w-8 rounded bg-slate-100 p-1"
                />
                <div>
                  <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100">
                    {selectedLead.name}
                  </h2>
                  <a
                    href={selectedLead.website}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-blue-600 hover:underline flex items-center gap-1 mt-0.5"
                  >
                    {selectedLead.domain}
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </div>
              </div>

              <Button variant="ghost" size="icon" onClick={() => setSelectedLead(null)}>
                <X className="h-5 w-5 text-slate-400" />
              </Button>
            </div>

            {/* Drawer Body */}
            <div className="p-6 space-y-6 flex-1">
              {/* Score Breakdown Card */}
              <Card className="border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-850">
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base flex items-center gap-2">
                      <Zap className="h-4 w-4 text-amber-500" />
                      Lead Score Breakdown
                    </CardTitle>
                    <div className="flex items-center gap-2">
                      <span className="text-2xl font-black text-slate-900 dark:text-slate-100">
                        {selectedLead.score?.total || 0}
                      </span>
                      <span className="text-xs text-slate-400">/ 100</span>
                      <Badge variant={(selectedLead.score?.tier || "hot") as any} className="capitalize ml-1">
                        {selectedLead.score?.tier || "hot"}
                      </Badge>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  {/* Fit Bar */}
                  <div>
                    <div className="flex justify-between text-xs mb-1">
                      <span className="font-medium text-slate-600 dark:text-slate-300">Fit (Firmographics & Domain)</span>
                      <span className="font-bold">{selectedLead.score?.fit || 0} / 40</span>
                    </div>
                    <div className="h-2 w-full rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden">
                      <div
                        className="h-full bg-blue-600 rounded-full"
                        style={{ width: `${((selectedLead.score?.fit || 0) / 40) * 100}%` }}
                      />
                    </div>
                  </div>

                  {/* Intent Bar */}
                  <div>
                    <div className="flex justify-between text-xs mb-1">
                      <span className="font-medium text-slate-600 dark:text-slate-300">Intent & Buying Signals</span>
                      <span className="font-bold">{selectedLead.score?.intent || 0} / 30</span>
                    </div>
                    <div className="h-2 w-full rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden">
                      <div
                        className="h-full bg-emerald-500 rounded-full"
                        style={{ width: `${((selectedLead.score?.intent || 0) / 30) * 100}%` }}
                      />
                    </div>
                  </div>

                  {/* Reachability Bar */}
                  <div>
                    <div className="flex justify-between text-xs mb-1">
                      <span className="font-medium text-slate-600 dark:text-slate-300">Reachability & Accessibility</span>
                      <span className="font-bold">{selectedLead.score?.reachability || 0} / 30</span>
                    </div>
                    <div className="h-2 w-full rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden">
                      <div
                        className="h-full bg-indigo-500 rounded-full"
                        style={{ width: `${((selectedLead.score?.reachability || 0) / 30) * 100}%` }}
                      />
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Strategic Reasons & Why Now */}
              <div className="space-y-3">
                <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                  <Target className="h-4 w-4 text-blue-600" />
                  Why This Company?
                </h3>
                <ul className="space-y-1.5">
                  {selectedLead.score?.reasons?.map((reason, idx) => (
                    <li key={idx} className="flex items-start gap-2 text-xs text-slate-700 dark:text-slate-300">
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 mt-0.5 flex-shrink-0" />
                      <span>{reason}</span>
                    </li>
                  ))}
                </ul>

                {selectedLead.score?.whyNow && (
                  <div className="p-3 rounded-lg bg-amber-50/50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/60 mt-2">
                    <span className="text-[11px] font-bold text-amber-800 dark:text-amber-300 uppercase tracking-wide">
                      ⚡ Why Now Trigger
                    </span>
                    <p className="text-xs text-amber-900 dark:text-amber-200 mt-1">
                      {selectedLead.score.whyNow}
                    </p>
                  </div>
                )}

                {selectedLead.score?.pitchAngle && (
                  <div className="p-3 rounded-lg bg-blue-50/50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-900/60">
                    <span className="text-[11px] font-bold text-blue-800 dark:text-blue-300 uppercase tracking-wide">
                      🎯 Recommended Pitch Angle
                    </span>
                    <p className="text-xs text-blue-900 dark:text-blue-200 mt-1">
                      {selectedLead.score.pitchAngle}
                    </p>
                  </div>
                )}
              </div>

              {/* Live Web Evidence */}
              <div className="space-y-3">
                <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                  <Globe className="h-4 w-4 text-emerald-600" />
                  Live Web Search Evidence
                </h3>

                {selectedLead.enrichment?.results && selectedLead.enrichment.results.length > 0 ? (
                  <div className="space-y-2">
                    {selectedLead.enrichment.results.map((res, idx) => (
                      <div
                        key={idx}
                        className="p-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-800/40 space-y-1.5"
                      >
                        <div className="flex items-center justify-between text-xs">
                          <a
                            href={res.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="font-medium text-blue-600 hover:underline flex items-center gap-1"
                          >
                            {res.title || res.url}
                            <ExternalLink className="h-3 w-3" />
                          </a>
                          {res.publishDate && (
                            <span className="text-[11px] text-slate-400">{res.publishDate}</span>
                          )}
                        </div>
                        {res.excerpts?.map((exc, eIdx) => (
                          <p key={eIdx} className="text-xs text-slate-600 dark:text-slate-300 italic border-l-2 border-slate-300 dark:border-slate-700 pl-2">
                            "{exc}"
                          </p>
                        ))}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-slate-400 italic">No live web search excerpts retrieved.</p>
                )}
              </div>

              {/* Personalized Outreach Email */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                    <Mail className="h-4 w-4 text-indigo-600" />
                    Personalized Outreach Email
                  </h3>

                  {/* Regenerate tone controls */}
                  <div className="flex items-center gap-1">
                    <span className="text-[11px] text-slate-400 mr-1">Regenerate:</span>
                    <button
                      type="button"
                      disabled={isRegenerating}
                      onClick={() => handleRegenerateOutreach("formal")}
                      className="px-2 py-0.5 rounded text-[11px] border border-slate-200 hover:bg-slate-100 dark:border-slate-700 cursor-pointer"
                    >
                      Formal
                    </button>
                    <button
                      type="button"
                      disabled={isRegenerating}
                      onClick={() => handleRegenerateOutreach("friendly")}
                      className="px-2 py-0.5 rounded text-[11px] border border-slate-200 hover:bg-slate-100 dark:border-slate-700 cursor-pointer"
                    >
                      Friendly
                    </button>
                    <button
                      type="button"
                      disabled={isRegenerating}
                      onClick={() => handleRegenerateOutreach("short")}
                      className="px-2 py-0.5 rounded text-[11px] border border-slate-200 hover:bg-slate-100 dark:border-slate-700 cursor-pointer"
                    >
                      Short
                    </button>
                  </div>
                </div>

                <div className="p-4 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900 space-y-3">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-slate-600 dark:text-slate-400">Subject:</span>
                    <button
                      type="button"
                      onClick={() =>
                        copyToClipboard(selectedLead.outreach?.subject || "", "subject")
                      }
                      className="text-blue-600 hover:underline flex items-center gap-1 text-[11px] cursor-pointer"
                    >
                      {copiedField === "subject" ? (
                        <>
                          <Check className="h-3 w-3 text-emerald-600" />
                          Copied!
                        </>
                      ) : (
                        <>
                          <Copy className="h-3 w-3" />
                          Copy Subject
                        </>
                      )}
                    </button>
                  </div>
                  <div className="text-xs font-medium text-slate-900 dark:text-slate-100">
                    {selectedLead.outreach?.subject || "Partnership Opportunity"}
                  </div>

                  <div className="border-t border-slate-200 dark:border-slate-800 pt-2 flex items-center justify-between text-xs">
                    <span className="font-semibold text-slate-600 dark:text-slate-400">Body:</span>
                    <button
                      type="button"
                      onClick={() =>
                        copyToClipboard(selectedLead.outreach?.email || "", "email")
                      }
                      className="text-blue-600 hover:underline flex items-center gap-1 text-[11px] cursor-pointer"
                    >
                      {copiedField === "email" ? (
                        <>
                          <Check className="h-3 w-3 text-emerald-600" />
                          Copied!
                        </>
                      ) : (
                        <>
                          <Copy className="h-3 w-3" />
                          Copy Email
                        </>
                      )}
                    </button>
                  </div>
                  <pre className="text-xs text-slate-700 dark:text-slate-300 font-sans whitespace-pre-wrap leading-relaxed">
                    {selectedLead.outreach?.email || "Drafting outreach..."}
                  </pre>
                </div>

                {/* LinkedIn Note */}
                {selectedLead.outreach?.linkedinNote && (
                  <div className="p-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-1.5">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-semibold text-slate-600 dark:text-slate-400">
                        LinkedIn Connection Note (&le;300 chars):
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          copyToClipboard(selectedLead.outreach?.linkedinNote || "", "linkedin")
                        }
                        className="text-blue-600 hover:underline flex items-center gap-1 text-[11px] cursor-pointer"
                      >
                        {copiedField === "linkedin" ? (
                          <>
                            <Check className="h-3 w-3 text-emerald-600" />
                            Copied!
                          </>
                        ) : (
                          <>
                            <Copy className="h-3 w-3" />
                            Copy
                          </>
                        )}
                      </button>
                    </div>
                    <p className="text-xs text-slate-700 dark:text-slate-300">
                      "{selectedLead.outreach.linkedinNote}"
                    </p>
                  </div>
                )}
              </div>

              {/* Notes & Status */}
              <div className="space-y-3 pt-4 border-t border-slate-200 dark:border-slate-800">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                    <FileText className="h-4 w-4 text-slate-600" />
                    Internal Notes
                  </h3>
                  <Button size="sm" variant="secondary" onClick={handleSaveNotes} className="h-7 text-xs">
                    Save Notes
                  </Button>
                </div>
                <textarea
                  rows={3}
                  value={notesText}
                  onChange={(e) => setNotesText(e.target.value)}
                  placeholder="Record call logs, objection details, or next steps..."
                  className="w-full rounded-md border border-slate-200 bg-transparent p-2 text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-blue-600 dark:border-slate-800"
                />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
