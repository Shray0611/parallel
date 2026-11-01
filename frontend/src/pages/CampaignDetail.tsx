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
  ChevronDown,
  ChevronUp,
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
  FileText,
  AlertCircle,
  Globe,
  Edit3,
  PlusCircle,
  MoreVertical,
  Trash2
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

function countryLabel(code?: string) {
  if (!code) return "";
  return QUERY_COUNTRIES.find((item) => item.code === code)?.name || code;
}

const QUERY_COUNTRIES = [
  { code: "IN", name: "India" },
  { code: "US", name: "United States" },
  { code: "GB", name: "United Kingdom" },
  { code: "DE", name: "Germany" },
  { code: "SG", name: "Singapore" },
  { code: "AE", name: "United Arab Emirates" },
  { code: "AU", name: "Australia" },
  { code: "CA", name: "Canada" }
];

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

  // View Mode
  const [viewMode, setViewMode] = useState<"grouped" | "table" | "kanban">("grouped");

  // Per-query "Find More" loading state: Map<objectiveIndex, boolean>
  const [findMoreLoading, setFindMoreLoading] = useState<Record<number, boolean>>({});

  // Collapsed query groups
  const [collapsedGroups, setCollapsedGroups] = useState<Record<number, boolean>>({});

  // Edit Query Modal
  const [editQueryModal, setEditQueryModal] = useState<{ open: boolean; index: number; text: string; rationale: string; domain: string; queries: string[]; country: string; city: string } | null>(null);
  const [draftModal, setDraftModal] = useState<{
    country: string;
    city: string;
    domain: string;
    focus: string;
    objective: string;
    rationale: string;
    queries: string[];
    ready: boolean;
  } | null>(null);
  const [editQuerySaving, setEditQuerySaving] = useState(false);
  const [enhancingQuery, setEnhancingQuery] = useState(false);
  const [generatingQuery, setGeneratingQuery] = useState(false);
  const [activeSearch, setActiveSearch] = useState<{ index: number; objective: string } | null>(null);
  const [rerunAfterEdit, setRerunAfterEdit] = useState(false);

  // Fetches
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
      const res = await apiRequest<{ leads: Lead[] }>(`/campaigns/${id}/leads?limit=200`);
      setLeads(res.leads);
      setIsLoading(false);
    } catch (err: any) {
      toast.error(err.message || "Failed to load leads");
      setIsLoading(false);
    }
  };

  const openLeadDetail = async (lead: Lead) => {
    setSelectedLead(lead);
    const leadId = lead._id || lead.id;
    if (!leadId) return;
    try {
      const res = await apiRequest<{ lead: Lead }>(`/leads/${leadId}`);
      setSelectedLead(res.lead);
    } catch {
      // keep existing
    }
  };

  useEffect(() => {
    fetchCampaign();
    fetchLeads();
  }, [id]);

  // SSE Live Progress
  useEffect(() => {
    if (!id) return;
    const API_URL = import.meta.env.VITE_API_URL || "http://localhost:4000";
    const eventSource = new EventSource(`${API_URL}/api/campaigns/${id}/events`);

    eventSource.addEventListener("progress", (e) => {
      try {
        const data = JSON.parse(e.data);
        setCampaign((prev) => {
          if (!prev) return null;
          return { ...prev, status: data.stage === "completed" ? "completed" : "running", progress: { stage: data.stage, current: data.current, total: data.total, message: data.message } };
        });
        if (typeof data.objectiveIndex === "number") {
          setActiveSearch({ index: data.objectiveIndex, objective: data.objective || data.message });
          if (data.stage !== "completed") {
            setFindMoreLoading({ [data.objectiveIndex]: true });
          }
        }
        setEventLogs((prev) => [{ time: new Date().toLocaleTimeString(), msg: data.message, stage: data.stage }, ...prev.slice(0, 49)]);
      } catch {}
    });

    eventSource.addEventListener("lead_added", (e) => {
      try {
        const data = JSON.parse(e.data);
        setLeads((prev) => {
          const exists = prev.some((l) => (l._id || l.id) === (data.lead._id || data.lead.id));
          if (exists) return prev;
          return [data.lead, ...prev];
        });
      } catch {}
    });

    eventSource.addEventListener("lead_scored", (e) => {
      try {
        const data = JSON.parse(e.data);
        setLeads((prev) => prev.map((l) => (l._id || l.id) === (data.lead._id || data.lead.id) ? data.lead : l));
      } catch {}
    });

    eventSource.addEventListener("done", (e) => {
      try {
        const data = JSON.parse(e.data);
        toast.success("Discovery and AI scoring completed!");
        setCampaign((prev) => {
          if (!prev) return null;
          return { ...prev, status: "completed", stats: data.stats || prev.stats, progress: { ...prev.progress, stage: "completed", message: "Pipeline completed successfully" } };
        });
        // Reset find-more loading states
        setFindMoreLoading({});
        setActiveSearch(null);
        fetchLeads();
        fetchCampaign();
      } catch {}
    });

    eventSource.addEventListener("error", (e) => {
      try {
        const data = JSON.parse((e as any).data || "{}");
        toast.error(data.message || "Pipeline error");
        setFindMoreLoading({});
        setActiveSearch(null);
      } catch {}
    });

    return () => { eventSource.close(); };
  }, [id]);

  useEffect(() => {
    if (selectedLead) setNotesText(selectedLead.notes || "");
  }, [selectedLead]);

  // ── Handlers ──────────────────────────────────────────────────────────────

  const isRunning = campaign?.status === "running";
  const searchLocked = isRunning || generatingQuery || Object.values(findMoreLoading).some(Boolean);

  const handleStatusChange = async (leadId: string, newStatus: Lead["status"]) => {
    try {
      await apiRequest(`/leads/${leadId}`, { method: "PATCH", body: JSON.stringify({ status: newStatus }) });
      setLeads((prev) => prev.map((l) => ((l._id || l.id) === leadId ? { ...l, status: newStatus } : l)));
      if (selectedLead && (selectedLead._id || selectedLead.id) === leadId) {
        setSelectedLead({ ...selectedLead, status: newStatus });
      }
      toast.success(`Marked as ${newStatus}`);
    } catch (err: any) {
      toast.error(err.message || "Failed to update lead status");
    }
  };

  const handleSaveNotes = async () => {
    if (!selectedLead) return;
    const leadId = selectedLead._id || selectedLead.id;
    try {
      await apiRequest(`/leads/${leadId}`, { method: "PATCH", body: JSON.stringify({ notes: notesText }) });
      setLeads((prev) => prev.map((l) => ((l._id || l.id) === leadId ? { ...l, notes: notesText } : l)));
      toast.success("Notes saved");
    } catch (err: any) {
      toast.error(err.message || "Failed to save notes");
    }
  };

  const handleRegenerateOutreach = async (tone: "formal" | "friendly" | "short") => {
    if (!selectedLead) return;
    const leadId = selectedLead._id || selectedLead.id;
    setIsRegenerating(true);
    try {
      const res = await apiRequest<{ outreach: Lead["outreach"] }>(`/leads/${leadId}/regenerate-outreach`, { method: "POST", body: JSON.stringify({ tone }) });
      setSelectedLead({ ...selectedLead, outreach: res.outreach });
      setLeads((prev) => prev.map((l) => ((l._id || l.id) === leadId ? { ...l, outreach: res.outreach } : l)));
      toast.success(`Regenerated outreach (${tone} tone)`);
    } catch (err: any) {
      toast.error(err.message || "Failed to regenerate outreach");
    } finally {
      setIsRegenerating(false);
    }
  };

  const copyToClipboard = (text: string, field: string) => {
    navigator.clipboard.writeText(text);
    setCopiedField(field);
    toast.success("Copied to clipboard!");
    setTimeout(() => setCopiedField(null), 2000);
  };

  const handleExportCsv = () => {
    const API_URL = import.meta.env.VITE_API_URL || "http://localhost:4000";
    window.open(`${API_URL}/api/campaigns/${id}/export.csv`, "_blank");
    toast.info("Downloading leads CSV export...");
  };

  // Find more leads for a given objective index
  const handleFindMore = async (objectiveIndex: number) => {
    if (searchLocked) return;
    const objective = campaign?.searchObjectives?.[objectiveIndex]?.objective || "";
    setActiveSearch({ index: objectiveIndex, objective });
    setFindMoreLoading({ [objectiveIndex]: true });
    try {
      await apiRequest(`/campaigns/${id}/queries/${objectiveIndex}/find-more`, { method: "POST" });
      toast.info(`Finding more leads for Search ${objectiveIndex + 1}…`);
      // SSE will deliver new leads; also poll after a delay
      setTimeout(fetchLeads, 15000);
    } catch (err: any) {
      toast.error(err.message || "Failed to find more leads");
      setFindMoreLoading({});
      setActiveSearch(null);
    }
  };

  // Open edit query modal
  const openEditQuery = (index: number) => {
    const obj = campaign?.searchObjectives?.[index];
    if (!obj) return;
    setEditQueryModal({
      open: true,
      index,
      text: obj.objective,
      rationale: (obj as any).rationale || "",
      domain: (obj as any).domain || "",
      queries: (obj as any).queries || [],
      country: (obj as any).country || campaign?.filters?.country || "IN",
      city: (obj as any).city || campaign?.filters?.city || ""
    });
    setRerunAfterEdit(false);
  };

  // Save edited query
  const handleSaveEditQuery = async () => {
    if (!editQueryModal) return;
    setEditQuerySaving(true);
    try {
      await apiRequest(`/campaigns/${id}/queries/${editQueryModal.index}`, {
        method: "PUT",
        body: JSON.stringify({
          objective: editQueryModal.text,
          rationale: editQueryModal.rationale,
          domain: editQueryModal.domain,
          queries: editQueryModal.queries,
          country: editQueryModal.country,
          city: editQueryModal.city
        })
      });
      await fetchCampaign();
      toast.success("Query updated!");

      if (rerunAfterEdit) {
        setEditQueryModal(null);
        await handleRerunQuery(editQueryModal.index);
      } else {
        setEditQueryModal(null);
      }
    } catch (err: any) {
      toast.error(err.message || "Failed to update query");
    } finally {
      setEditQuerySaving(false);
    }
  };

  // Rerun a specific query
  const handleEnhanceQuery = async () => {
    if (!editQueryModal) return;
    setEnhancingQuery(true);
    try {
      const res = await apiRequest<{ objective: { domain?: string; objective: string; rationale: string; queries?: string[] } }>(
        `/campaigns/${id}/queries/enhance`,
        {
          method: "POST",
          body: JSON.stringify({
            objective: editQueryModal.text,
            rationale: editQueryModal.rationale,
            domain: editQueryModal.domain,
            country: editQueryModal.country,
            city: editQueryModal.city
          })
        }
      );
      setEditQueryModal({
        ...editQueryModal,
        text: res.objective.objective,
        rationale: res.objective.rationale || editQueryModal.rationale,
        domain: res.objective.domain || editQueryModal.domain,
        queries: res.objective.queries || editQueryModal.queries
      });
      toast.success("Query enhanced. Review it, then save.");
    } catch (err: any) {
      toast.error(err.message || "Could not enhance this query");
    } finally {
      setEnhancingQuery(false);
    }
  };

  const openDraftModal = () => {
    if (searchLocked) return;
    setDraftModal({
      country: campaign?.filters?.country || "IN",
      city: campaign?.filters?.city || "",
      domain: campaign?.filters?.domains?.[0] || "",
      focus: "",
      objective: "",
      rationale: "",
      queries: [],
      ready: false
    });
  };

  const handleDraftQuery = async () => {
    if (!draftModal) return;
    setGeneratingQuery(true);
    try {
      const res = await apiRequest<{ objective: { domain?: string; objective: string; rationale: string; queries?: string[]; country?: string; city?: string } }>(
        `/campaigns/${id}/queries/draft`,
        {
          method: "POST",
          body: JSON.stringify({
            country: draftModal.country,
            city: draftModal.city,
            domain: draftModal.domain,
            focus: draftModal.focus
          })
        }
      );
      setDraftModal({
        ...draftModal,
        domain: res.objective.domain || draftModal.domain,
        objective: res.objective.objective,
        rationale: res.objective.rationale || "",
        queries: res.objective.queries || [],
        country: res.objective.country || draftModal.country,
        city: res.objective.city || draftModal.city,
        ready: true
      });
    } catch (err: any) {
      toast.error(err.message || "Could not draft a query");
    } finally {
      setGeneratingQuery(false);
    }
  };

  const handleSaveDraft = async () => {
    if (!draftModal?.objective.trim()) return;
    setGeneratingQuery(true);
    try {
      await apiRequest(`/campaigns/${id}/queries`, {
        method: "POST",
        body: JSON.stringify({
          domain: draftModal.domain,
          objective: draftModal.objective,
          rationale: draftModal.rationale,
          queries: draftModal.queries,
          country: draftModal.country,
          city: draftModal.city
        })
      });
      await fetchCampaign();
      setDraftModal(null);
      toast.success("Query added. Use Find More Leads when you want to search it.");
    } catch (err: any) {
      toast.error(err.message || "Could not save this query");
    } finally {
      setGeneratingQuery(false);
    }
  };

  const handleDeleteQuery = async (objectiveIndex: number) => {
    if (searchLocked) return;
    const label = campaign?.searchObjectives?.[objectiveIndex]?.objective || `Search ${objectiveIndex + 1}`;
    if (!window.confirm(`Delete this query and its leads?\n\n${label}`)) return;
    try {
      await apiRequest(`/campaigns/${id}/queries/${objectiveIndex}`, { method: "DELETE" });
      await Promise.all([fetchCampaign(), fetchLeads()]);
      toast.success("Query deleted");
    } catch (err: any) {
      toast.error(err.message || "Could not delete this query");
    }
  };

  const handleRerunQuery = async (objectiveIndex: number) => {
    if (searchLocked) return;
    const objective = campaign?.searchObjectives?.[objectiveIndex]?.objective || "";
    setActiveSearch({ index: objectiveIndex, objective });
    setFindMoreLoading({ [objectiveIndex]: true });
    try {
      await apiRequest(`/campaigns/${id}/queries/${objectiveIndex}/rerun`, { method: "POST" });
      toast.info(`Re-running Search ${objectiveIndex + 1}…`);
      setTimeout(fetchLeads, 20000);
    } catch (err: any) {
      toast.error(err.message || "Failed to rerun query");
      setFindMoreLoading({});
      setActiveSearch(null);
    }
  };

  // ── Derived Data ───────────────────────────────────────────────────────────

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

  // Group filtered leads by sourceObjectiveIndex
  const groupedLeads = useMemo(() => {
    const groups = new Map<number, Lead[]>();
    filteredLeads.forEach((lead) => {
      const idx = (lead as any).sourceObjectiveIndex ?? 0;
      if (!groups.has(idx)) groups.set(idx, []);
      groups.get(idx)!.push(lead);
    });
    return groups;
  }, [filteredLeads]);

  const uniqueIndustries = useMemo(() => {
    const set = new Set<string>();
    leads.forEach((l) => { if (l.score?.industry) set.add(l.score.industry); });
    return Array.from(set);
  }, [leads]);

  const stages = [
    { key: "icp", label: "1. ICP Strategy" },
    { key: "discover", label: "2. FindAll Discovery" },
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

  // ── Lead Row component (shared between table and grouped view) ─────────────
  const LeadRow = ({ lead }: { lead: Lead }) => {
    const leadId = lead._id || lead.id || "";
    const totalScore = lead.score?.total || 0;
    const tier = lead.score?.tier || (totalScore >= 70 ? "hot" : totalScore >= 45 ? "warm" : "cold");

    return (
      <tr
        key={leadId}
        className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition-colors cursor-pointer"
        onClick={() => openLeadDetail(lead)}
      >
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
        <td className="px-4 py-4 text-xs">
          <div className="font-medium text-slate-800 dark:text-slate-200">{lead.score?.industry || "Enterprise"}</div>
          <div className="text-slate-400 mt-0.5">
            {lead.score?.estimatedSize || campaign?.filters?.companySize || "Mid-Market"} • {lead.score?.location || campaign?.filters?.country}
          </div>
        </td>
        <td className="px-4 py-4">
          <div className="flex items-center gap-2">
            <div className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold text-white ${tier === "hot" ? "bg-red-600" : tier === "warm" ? "bg-amber-500" : "bg-slate-500"}`}>
              {totalScore}
            </div>
            <Badge variant={tier as any} className="capitalize text-[11px]">{tier}</Badge>
          </div>
        </td>
        <td className="px-4 py-4 text-xs text-slate-600 dark:text-slate-300 max-w-xs line-clamp-2">
          {lead.score?.whyNow || lead.description || "Active enterprise modernization"}
        </td>
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
        <td className="px-4 py-4 text-right">
          <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); openLeadDetail(lead); }} className="text-xs text-blue-600 hover:text-blue-700 dark:text-blue-400">
            Details <ChevronRight className="h-3 w-3 ml-1" />
          </Button>
        </td>
      </tr>
    );
  };

  // ── Search Objective Group header ──────────────────────────────────────────
  const QueryGroupHeader = ({ objectiveIndex }: { objectiveIndex: number }) => {
    const obj = campaign?.searchObjectives?.[objectiveIndex];
    const groupLeads = leads.filter((l) => (l as any).sourceObjectiveIndex === objectiveIndex);
    const isFindingMore = findMoreLoading[objectiveIndex];
    const isCollapsed = collapsedGroups[objectiveIndex];

    return (
      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between flex-wrap gap-2 px-4 py-3 bg-slate-50 dark:bg-slate-900/60 border-b border-slate-200 dark:border-slate-800">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setCollapsedGroups((prev) => ({ ...prev, [objectiveIndex]: !isCollapsed }))}
              className="p-0.5 rounded hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors flex-shrink-0"
            >
              {isCollapsed ? <ChevronDown className="h-4 w-4 text-slate-500" /> : <ChevronUp className="h-4 w-4 text-slate-500" />}
            </button>
            <div className="flex items-center gap-2 min-w-0">
              <span className="flex-shrink-0 inline-flex items-center justify-center h-6 w-6 rounded-full bg-blue-100 dark:bg-blue-950 text-blue-700 dark:text-blue-300 text-xs font-bold">
                {objectiveIndex + 1}
              </span>
              <span className="text-sm font-semibold text-slate-800 dark:text-slate-200 truncate max-w-xl">
                {obj?.objective || `Search ${objectiveIndex + 1}`}
              </span>
            </div>
            <Badge variant="outline" className="text-[10px] flex-shrink-0">
              {groupLeads.length} lead{groupLeads.length !== 1 ? "s" : ""}
            </Badge>
            {(obj as any)?.domain && (
              <Badge variant="secondary" className="text-[10px] flex-shrink-0">{(obj as any).domain}</Badge>
            )}
            <Badge variant="outline" className="text-[10px] flex-shrink-0">
              {(obj as any)?.city ? `${(obj as any).city}, ` : ""}{countryLabel((obj as any)?.country || campaign?.filters?.country || "IN")}
            </Badge>
          </div>

          <div className="flex items-center gap-2 flex-shrink-0">
            {/* Edit Query */}
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs gap-1.5 text-slate-600 hover:text-slate-900"
              onClick={() => openEditQuery(objectiveIndex)}
              disabled={searchLocked}
            >
              <Edit3 className="h-3.5 w-3.5" />
              Edit Query
            </Button>

            {/* Rerun */}
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs gap-1.5 text-slate-600 hover:text-slate-900"
              onClick={() => handleRerunQuery(objectiveIndex)}
              disabled={searchLocked}
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isFindingMore ? "animate-spin" : ""}`} />
              Rerun
            </Button>

            {/* Find More */}
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs gap-1.5 border-blue-200 text-blue-700 hover:bg-blue-50 dark:border-blue-900 dark:text-blue-300 dark:hover:bg-blue-950/40"
              onClick={() => handleFindMore(objectiveIndex)}
              disabled={searchLocked}
            >
              {isFindingMore ? (
                <>
                  <Clock className="h-3.5 w-3.5 animate-spin" />
                  Finding...
                </>
              ) : (
                <>
                  <PlusCircle className="h-3.5 w-3.5" />
                  Find More Leads
                </>
              )}
            </Button>

            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs gap-1.5 text-rose-600 hover:text-rose-700"
              onClick={() => handleDeleteQuery(objectiveIndex)}
              disabled={searchLocked}
            >
              <Trash2 className="h-3.5 w-3.5" />
              Delete
            </Button>
          </div>
        </div>

        {!isCollapsed && ((obj as any)?.queries?.length > 0 || obj?.rationale) && (
          <div className="px-4 py-2 space-y-1.5 border-b border-slate-100 dark:border-slate-800/60 bg-slate-50/50 dark:bg-slate-900/30">
            {obj?.rationale && (
              <p className="text-xs text-slate-500 dark:text-slate-400 italic">{(obj as any).rationale}</p>
            )}
            {(obj as any)?.queries?.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {(obj as any).queries.map((query: string, queryIndex: number) => (
                  <span key={`${queryIndex}-${query}`} className="rounded-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 px-2 py-0.5 text-[11px] text-slate-600 dark:text-slate-300">
                    {query}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  // ── Main render ────────────────────────────────────────────────────────────
  return (
    <div className="dashboard-theme mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8 space-y-6">
      {/* Top Navigation */}
      <div className="flex items-center gap-2 text-sm text-slate-500">
        <Link to="/" className="hover:text-blue-600 flex items-center gap-1">
          <ArrowLeft className="h-4 w-4" /> Dashboard
        </Link>
        <span>/</span>
        <span className="font-medium text-slate-900 dark:text-slate-100">{campaign?.title || "Campaign Details"}</span>
      </div>

      {/* Campaign Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-6">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">{campaign?.title}</h1>
            <Badge
              variant={campaign?.status === "completed" ? "default" : campaign?.status === "running" ? "warm" : "outline"}
              className="capitalize"
            >
              {campaign?.status === "running" && <span className="h-1.5 w-1.5 rounded-full bg-amber-500 animate-pulse mr-1.5" />}
              {campaign?.status || "draft"}
            </Badge>
          </div>
          <p className="text-sm text-slate-600 dark:text-slate-400 mt-1 max-w-2xl line-clamp-2">{campaign?.offering}</p>
          <div className="flex flex-wrap items-center gap-2 mt-3 text-xs">
            <Badge variant="outline">{campaign?.filters?.country} Market</Badge>
            <Badge variant="outline">{campaign?.filters?.companySize} Employees</Badge>
            {campaign?.filters?.domains?.map((d) => <Badge key={d} variant="secondary">{d}</Badge>)}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="outline" onClick={handleExportCsv} className="gap-2">
            <Download className="h-4 w-4" /> Export CSV
          </Button>
          <Button variant="ghost" onClick={() => setShowLogs(!showLogs)} className="text-xs text-slate-500 hover:text-slate-900 dark:hover:text-slate-100">
            <Activity className="h-4 w-4 mr-1 text-blue-500" />
            {showLogs ? "Hide Logs" : `Logs (${eventLogs.length})`}
          </Button>
        </div>
      </div>

      {/* Pipeline Stepper */}
      <Card className="border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
        <div className="p-4 bg-slate-50 dark:bg-slate-900/60 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-blue-600 dark:text-blue-400" />
            <span className="text-sm font-semibold">Live Intelligence Pipeline</span>
            {isRunning && <span className="ml-1 text-xs text-amber-600 dark:text-amber-400 animate-pulse font-medium">Running…</span>}
          </div>
          <span className="text-xs text-slate-500 dark:text-slate-400">{campaign?.progress?.message || "Pipeline inactive"}</span>
        </div>
        {activeSearch && (
          <div className="px-4 py-2 border-b border-blue-100 dark:border-blue-900 bg-blue-50/80 dark:bg-blue-950/40 text-sm text-blue-800 dark:text-blue-200 flex items-center gap-2">
            <Clock className="h-4 w-4 animate-spin shrink-0" />
            <span>
              Currently finding leads for query {activeSearch.index + 1}: {activeSearch.objective}
            </span>
          </div>
        )}
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
                    <span className="h-4 w-4 rounded-full border border-current flex items-center justify-center text-[10px] flex-shrink-0">{idx + 1}</span>
                  )}
                  <span className="truncate">{stg.label}</span>
                </div>
              );
            })}
          </div>

          {showLogs && (
            <div className="mt-4 p-3 rounded-lg bg-slate-950 text-slate-200 font-mono text-xs max-h-48 overflow-y-auto space-y-1">
              <div className="text-[11px] text-slate-400 font-bold uppercase tracking-wider mb-2">SSE Live Stream Log</div>
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

      {/* Parallel API usage */}
      {campaign?.stats?.apiCalls && (
        <div className="flex flex-wrap items-center gap-2 text-[11px]">
          <span className="font-semibold text-slate-500 uppercase tracking-wide mr-1">Parallel APIs</span>
          {[
            { label: "Entity Search", value: campaign.stats.apiCalls.parallelEntity },
            { label: "FindAll", value: campaign.stats.apiCalls.parallelFindAll },
            { label: "Search", value: campaign.stats.apiCalls.parallelSearch },
            { label: "Task", value: campaign.stats.apiCalls.parallelTask },
            { label: "Monitor", value: campaign.stats.apiCalls.parallelMonitor }
          ].map((item) => (
            <Badge key={item.label} variant="outline" className="text-[10px] font-medium">
              {item.label} {item.value || 0}
            </Badge>
          ))}
        </div>
      )}

      {/* KPI Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {[
          { label: "Found Leads", value: campaign?.stats?.found || leads.length, color: "" },
          { label: "Enriched", value: campaign?.stats?.enriched || leads.filter((l) => l.enrichment).length, color: "" },
          { label: "Scored", value: campaign?.stats?.scored || leads.filter((l) => l.score).length, color: "" },
          { label: "🔥 Hot (≥70)", value: campaign?.stats?.hot || leads.filter((l) => l.score?.tier === "hot").length, color: "border-red-200 bg-red-50/40 dark:border-red-950 dark:bg-red-950/20 text-red-700 dark:text-red-400" },
          { label: "⚡ Warm (45-69)", value: campaign?.stats?.warm || leads.filter((l) => l.score?.tier === "warm").length, color: "border-amber-200 bg-amber-50/40 dark:border-amber-950 dark:bg-amber-950/20 text-amber-700 dark:text-amber-400" },
          { label: "Cold (<45)", value: campaign?.stats?.cold || leads.filter((l) => l.score?.tier === "cold").length, color: "" }
        ].map((stat) => (
          <div key={stat.label} className={`p-3 rounded-lg border ${stat.color || "border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900"}`}>
            <span className={`text-xs font-medium ${stat.color ? "" : "text-slate-500"}`}>{stat.label}</span>
            <div className="text-xl font-bold mt-1">{stat.value}</div>
          </div>
        ))}
      </div>

      {/* Filter Bar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm">
        <div className="flex items-center gap-2 flex-1 max-w-md">
          <Search className="h-4 w-4 text-slate-400" />
          <Input placeholder="Search companies, domains, or descriptions..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="h-8 text-xs" />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select value={tierFilter} onChange={(e) => setTierFilter(e.target.value as any)} className="h-8 rounded-md border border-slate-200 bg-transparent px-2.5 text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-blue-600 dark:border-slate-800 dark:bg-slate-900">
            <option value="all">All Tiers</option>
            <option value="hot">Hot Only</option>
            <option value="warm">Warm Only</option>
            <option value="cold">Cold Only</option>
          </select>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="h-8 rounded-md border border-slate-200 bg-transparent px-2.5 text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-blue-600 dark:border-slate-800 dark:bg-slate-900">
            <option value="all">All Statuses</option>
            <option value="new">New</option>
            <option value="contacted">Contacted</option>
            <option value="replied">Replied</option>
            <option value="qualified">Qualified</option>
            <option value="lost">Lost</option>
          </select>
          {uniqueIndustries.length > 0 && (
            <select value={industryFilter} onChange={(e) => setIndustryFilter(e.target.value)} className="h-8 rounded-md border border-slate-200 bg-transparent px-2.5 text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-blue-600 dark:border-slate-800 dark:bg-slate-900">
              <option value="all">All Industries</option>
              {uniqueIndustries.map((ind) => <option key={ind} value={ind}>{ind}</option>)}
            </select>
          )}
          <select value={sortBy} onChange={(e) => setSortBy(e.target.value as any)} className="h-8 rounded-md border border-slate-200 bg-transparent px-2.5 text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-blue-600 dark:border-slate-800 dark:bg-slate-900">
            <option value="score_desc">Highest Score</option>
            <option value="score_asc">Lowest Score</option>
            <option value="name">Company Name</option>
          </select>
          {/* View Toggle */}
          <div className="flex items-center rounded-lg border border-slate-200 bg-slate-100 p-0.5 dark:border-slate-800 dark:bg-slate-800 ml-2">
            {(["grouped", "table", "kanban"] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => setViewMode(mode)}
                className={`px-2.5 py-1 text-xs font-semibold rounded-md transition-colors capitalize ${
                  viewMode === mode ? "bg-white text-blue-600 shadow-xs dark:bg-slate-900 dark:text-blue-400" : "text-slate-500 hover:text-slate-900 dark:hover:text-slate-100"
                }`}
              >
                {mode}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── VIEW: Grouped by Search Query ─────────────────────────────────── */}
      {viewMode === "grouped" && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <Button variant="outline" size="sm" className="gap-1.5" onClick={openDraftModal} disabled={searchLocked}>
              <Sparkles className={`h-3.5 w-3.5 ${generatingQuery ? "animate-spin" : ""}`} />
              Generate query from this campaign
            </Button>
          </div>
          {isLoading ? (
            <div className="text-center py-12 text-slate-500">
              <Clock className="h-6 w-6 animate-spin mx-auto mb-2 text-blue-600" />
              Loading leads...
            </div>
          ) : campaign?.searchObjectives && campaign.searchObjectives.length > 0 ? (
            campaign.searchObjectives.map((_, objIdx) => {
              const groupLeads = groupedLeads.get(objIdx) || [];
              const isCollapsed = collapsedGroups[objIdx];
              return (
                <Card key={objIdx} className="border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
                  <QueryGroupHeader objectiveIndex={objIdx} />
                  {!isCollapsed && (
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
                          {groupLeads.length === 0 ? (
                            <tr>
                              <td colSpan={6} className="text-center py-10 text-slate-400">
                                <div className="flex flex-col items-center gap-2">
                                  <Search className="h-5 w-5 text-slate-300" />
                                  <span className="text-sm">No leads found for this search yet.</span>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="mt-1 text-xs gap-1.5 border-blue-200 text-blue-700 hover:bg-blue-50"
                                    onClick={() => handleFindMore(objIdx)}
                                    disabled={searchLocked}
                                  >
                                    <PlusCircle className="h-3.5 w-3.5" />
                                    {findMoreLoading[objIdx] ? "Searching..." : "Find Leads Now"}
                                  </Button>
                                </div>
                              </td>
                            </tr>
                          ) : (
                            groupLeads.map((lead) => <LeadRow key={lead._id || lead.id} lead={lead} />)
                          )}
                        </tbody>
                      </table>
                    </div>
                  )}
                </Card>
              );
            })
          ) : (
            // No objectives yet — show all leads in flat table
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
                    {filteredLeads.length === 0 ? (
                      <tr><td colSpan={6} className="text-center py-12 text-slate-500">No leads found.</td></tr>
                    ) : (
                      filteredLeads.map((lead) => <LeadRow key={lead._id || lead.id} lead={lead} />)
                    )}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </div>
      )}

      {/* ── VIEW: Flat Table ──────────────────────────────────────────────── */}
      {viewMode === "table" && (
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
                  <tr><td colSpan={6} className="text-center py-12 text-slate-500"><Clock className="h-6 w-6 animate-spin mx-auto mb-2 text-blue-600" />Loading leads...</td></tr>
                ) : filteredLeads.length === 0 ? (
                  <tr><td colSpan={6} className="text-center py-12 text-slate-500">No leads match your active filters.</td></tr>
                ) : (
                  filteredLeads.map((lead) => <LeadRow key={lead._id || lead.id} lead={lead} />)
                )}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* ── VIEW: Kanban ──────────────────────────────────────────────────── */}
      {viewMode === "kanban" && (
        <div className="grid grid-cols-1 md:grid-cols-5 gap-4 overflow-x-auto pb-4">
          {(
            [
              { status: "new", title: "New", color: "bg-slate-500", border: "border-slate-200 dark:border-slate-800" },
              { status: "contacted", title: "Contacted", color: "bg-blue-600", border: "border-blue-200 dark:border-blue-900" },
              { status: "replied", title: "Replied", color: "bg-indigo-600", border: "border-indigo-200 dark:border-indigo-900" },
              { status: "qualified", title: "Qualified", color: "bg-emerald-600", border: "border-emerald-200 dark:border-emerald-900" },
              { status: "lost", title: "Lost", color: "bg-rose-600", border: "border-rose-200 dark:border-rose-900" }
            ] as const
          ).map((col) => {
            const colLeads = filteredLeads.filter((l) => (l.status || "new") === col.status);
            return (
              <div key={col.status} className="flex flex-col rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-900/60 p-3 min-w-[220px]">
                <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-slate-800 mb-3">
                  <div className="flex items-center gap-2">
                    <span className={`h-2.5 w-2.5 rounded-full ${col.color}`} />
                    <span className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">{col.title}</span>
                  </div>
                  <Badge variant="outline" className="text-[10px] h-5 py-0">{colLeads.length}</Badge>
                </div>
                <div className="space-y-3 flex-1 overflow-y-auto max-h-[600px] pr-1">
                  {colLeads.length === 0 ? (
                    <div className="h-24 flex items-center justify-center text-xs text-slate-400 italic border border-dashed border-slate-200 dark:border-slate-800 rounded-lg">No leads</div>
                  ) : (
                    colLeads.map((lead) => {
                      const leadId = lead._id || lead.id || "";
                      const totalScore = lead.score?.total || 0;
                      const tier = lead.score?.tier || (totalScore >= 70 ? "hot" : totalScore >= 45 ? "warm" : "cold");
                      return (
                        <div key={leadId} onClick={() => openLeadDetail(lead)} className="p-3 bg-white dark:bg-slate-850 rounded-lg border border-slate-200 dark:border-slate-800 shadow-xs hover:border-blue-400 hover:shadow-sm transition-all cursor-pointer space-y-2.5">
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex items-center gap-2 min-w-0">
                              <img src={`https://www.google.com/s2/favicons?domain=${lead.domain}&sz=32`} alt="" className="h-5 w-5 rounded p-0.5 bg-slate-100 dark:bg-slate-800 flex-shrink-0" />
                              <h4 className="text-xs font-bold text-slate-900 dark:text-slate-100 truncate">{lead.name}</h4>
                            </div>
                            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded text-white flex-shrink-0 ${tier === "hot" ? "bg-red-600" : tier === "warm" ? "bg-amber-500" : "bg-slate-500"}`}>{totalScore}</span>
                          </div>
                          <div className="text-[11px] text-slate-500 dark:text-slate-400 line-clamp-2">{lead.score?.whyNow || lead.description || "Active prospect"}</div>
                          <div className="flex items-center justify-between pt-2 border-t border-slate-100 dark:border-slate-800/80 text-[10px]">
                            <span className="text-slate-400 font-medium truncate max-w-[100px]">{lead.score?.industry || "Enterprise"}</span>
                            <select value={lead.status} onClick={(e) => e.stopPropagation()} onChange={(e) => handleStatusChange(leadId, e.target.value as any)} className="h-6 rounded border border-slate-200 bg-slate-50 dark:bg-slate-800 px-1 text-[10px] font-medium">
                              <option value="new">Move: New</option>
                              <option value="contacted">Move: Contacted</option>
                              <option value="replied">Move: Replied</option>
                              <option value="qualified">Move: Qualified</option>
                              <option value="lost">Move: Lost</option>
                            </select>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {draftModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4">
          <div className="w-full max-w-xl bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-800">
              <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">New search query</h3>
              <button type="button" onClick={() => setDraftModal(null)} className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800">
                <X className="h-4 w-4 text-slate-400" />
              </button>
            </div>
            <div className="px-6 py-4 space-y-4 max-h-[70vh] overflow-y-auto">
              <p className="text-xs text-slate-500">Set the location and focus first. The draft is shown here so you can edit it before it is added.</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1.5">Country</label>
                  <select
                    value={draftModal.country}
                    onChange={(e) => setDraftModal({ ...draftModal, country: e.target.value, ready: false })}
                    className="w-full rounded-lg border border-slate-200 bg-slate-50 dark:bg-slate-800 dark:border-slate-700 px-3 py-2 text-sm"
                  >
                    {QUERY_COUNTRIES.map((item) => (
                      <option key={item.code} value={item.code}>{item.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1.5">City</label>
                  <input
                    value={draftModal.city}
                    onChange={(e) => setDraftModal({ ...draftModal, city: e.target.value, ready: false })}
                    placeholder="Optional"
                    className="w-full rounded-lg border border-slate-200 bg-slate-50 dark:bg-slate-800 dark:border-slate-700 px-3 py-2 text-sm"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1.5">Industry label</label>
                <input
                  value={draftModal.domain}
                  onChange={(e) => setDraftModal({ ...draftModal, domain: e.target.value, ready: false })}
                  placeholder="e.g. Fintech"
                  className="w-full rounded-lg border border-slate-200 bg-slate-50 dark:bg-slate-800 dark:border-slate-700 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1.5">What should this search focus on?</label>
                <textarea
                  rows={3}
                  value={draftModal.focus}
                  onChange={(e) => setDraftModal({ ...draftModal, focus: e.target.value, ready: false })}
                  placeholder="e.g. banks replacing manual loan-file review"
                  className="w-full rounded-lg border border-slate-200 bg-slate-50 dark:bg-slate-800 dark:border-slate-700 p-3 text-sm"
                />
              </div>
              {draftModal.ready && (
                <div className="space-y-3 border-t border-slate-200 dark:border-slate-800 pt-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1.5">Search sentence</label>
                    <textarea
                      rows={3}
                      value={draftModal.objective}
                      onChange={(e) => setDraftModal({ ...draftModal, objective: e.target.value })}
                      className="w-full rounded-lg border border-slate-200 bg-white dark:bg-slate-900 dark:border-slate-700 p-3 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1.5">Keyword queries</label>
                    <div className="space-y-1.5">
                      {draftModal.queries.map((query, queryIndex) => (
                        <input
                          key={queryIndex}
                          value={query}
                          onChange={(e) => {
                            const queries = [...draftModal.queries];
                            queries[queryIndex] = e.target.value;
                            setDraftModal({ ...draftModal, queries });
                          }}
                          className="w-full rounded-lg border border-slate-200 bg-white dark:bg-slate-900 dark:border-slate-700 px-3 py-2 text-sm"
                        />
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1.5">Why this angle</label>
                    <input
                      value={draftModal.rationale}
                      onChange={(e) => setDraftModal({ ...draftModal, rationale: e.target.value })}
                      className="w-full rounded-lg border border-slate-200 bg-white dark:bg-slate-900 dark:border-slate-700 px-3 py-2 text-sm"
                    />
                  </div>
                </div>
              )}
            </div>
            <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-slate-200 dark:border-slate-800">
              <Button variant="ghost" onClick={() => setDraftModal(null)} disabled={generatingQuery}>Cancel</Button>
              {!draftModal.ready ? (
                <Button onClick={handleDraftQuery} disabled={generatingQuery} className="gap-2">
                  {generatingQuery ? <Clock className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                  Generate draft
                </Button>
              ) : (
                <Button onClick={handleSaveDraft} disabled={generatingQuery || draftModal.objective.trim().length < 5} className="gap-2">
                  {generatingQuery ? <Clock className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                  Add query
                </Button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Edit Query Modal ───────────────────────────────────────────────── */}
      {editQueryModal?.open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4">
          <div className="w-full max-w-xl bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-800">
              <div className="flex items-center gap-2">
                <Edit3 className="h-4 w-4 text-blue-600" />
                <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">Edit Search Query #{editQueryModal.index + 1}</h3>
              </div>
              <button type="button" onClick={() => handleEnhanceQuery()} disabled={enhancingQuery || editQuerySaving} className="inline-flex items-center gap-1.5 rounded-md border border-blue-200 px-2.5 py-1 text-xs font-semibold text-blue-700 hover:bg-blue-50 disabled:opacity-50">
                <Sparkles className={`h-3.5 w-3.5 ${enhancingQuery ? "animate-spin" : ""}`} />
                Enhance with AI
              </button>
              <button type="button" onClick={() => setEditQueryModal(null)} className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors">
                <X className="h-4 w-4 text-slate-400" />
              </button>
            </div>
            <div className="px-6 py-4 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1.5">Search Objective</label>
                <textarea
                  rows={4}
                  value={editQueryModal.text}
                  onChange={(e) => setEditQueryModal({ ...editQueryModal, text: e.target.value })}
                  placeholder="Describe the companies you want to find..."
                  className="w-full rounded-lg border border-slate-200 bg-slate-50 dark:bg-slate-800 dark:border-slate-700 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1.5">Target country</label>
                  <select
                    value={editQueryModal.country}
                    onChange={(e) => setEditQueryModal({ ...editQueryModal, country: e.target.value })}
                    className="w-full rounded-lg border border-slate-200 bg-slate-50 dark:bg-slate-800 dark:border-slate-700 px-3 py-2 text-sm"
                  >
                    {QUERY_COUNTRIES.map((item) => (
                      <option key={item.code} value={item.code}>{item.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1.5">City (optional)</label>
                  <input
                    value={editQueryModal.city}
                    onChange={(e) => setEditQueryModal({ ...editQueryModal, city: e.target.value })}
                    placeholder="e.g. Bengaluru"
                    className="w-full rounded-lg border border-slate-200 bg-slate-50 dark:bg-slate-800 dark:border-slate-700 px-3 py-2 text-sm"
                  />
                </div>
              </div>
              <p className="text-[11px] text-slate-500">Changing the location starts a fresh search for this query. Earlier companies stay in the list.</p>
              {editQueryModal.queries.length > 0 && (
                <div>
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1.5">Keyword queries</label>
                  <div className="space-y-1.5">
                    {editQueryModal.queries.map((query, queryIndex) => (
                      <input
                        key={queryIndex}
                        value={query}
                        onChange={(e) => {
                          const queries = [...editQueryModal.queries];
                          queries[queryIndex] = e.target.value;
                          setEditQueryModal({ ...editQueryModal, queries });
                        }}
                        className="w-full rounded-lg border border-slate-200 bg-slate-50 dark:bg-slate-800 dark:border-slate-700 px-3 py-2 text-sm"
                      />
                    ))}
                  </div>
                </div>
              )}
              <div>
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1.5">Rationale (optional)</label>
                <input
                  type="text"
                  value={editQueryModal.rationale}
                  onChange={(e) => setEditQueryModal({ ...editQueryModal, rationale: e.target.value })}
                  placeholder="Why are you targeting these companies?"
                  className="w-full rounded-lg border border-slate-200 bg-slate-50 dark:bg-slate-800 dark:border-slate-700 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={rerunAfterEdit}
                  onChange={(e) => setRerunAfterEdit(e.target.checked)}
                  className="rounded border-slate-300"
                />
                <span className="text-sm text-slate-700 dark:text-slate-300">Save and find leads in this location</span>
              </label>
            </div>
            <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30">
              <Button variant="ghost" onClick={() => setEditQueryModal(null)} disabled={editQuerySaving}>Cancel</Button>
              <Button onClick={handleSaveEditQuery} disabled={editQuerySaving || !editQueryModal.text.trim()} className="gap-2">
                {editQuerySaving ? <><Clock className="h-4 w-4 animate-spin" /> Saving...</> : <><Check className="h-4 w-4" /> Save Query</>}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ── Lead Detail Slide-Over ─────────────────────────────────────────── */}
      {selectedLead && (
        <div className="fixed inset-0 z-50 overflow-hidden bg-slate-900/50 backdrop-blur-xs flex justify-end">
          <div className="w-full max-w-2xl bg-white dark:bg-slate-900 h-full shadow-2xl flex flex-col border-l border-slate-200 dark:border-slate-800 overflow-y-auto">
            {/* Drawer Header */}
            <div className="sticky top-0 z-10 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 p-6 flex items-start justify-between">
              <div className="flex items-center gap-3">
                <img src={`https://www.google.com/s2/favicons?domain=${selectedLead.domain}&sz=32`} alt="" className="h-8 w-8 rounded bg-slate-100 p-1" />
                <div>
                  <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100">{selectedLead.name}</h2>
                  <a href={selectedLead.website} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-600 hover:underline flex items-center gap-1 mt-0.5">
                    {selectedLead.domain}<ExternalLink className="h-3 w-3" />
                  </a>
                  {(selectedLead as any).sourceObjectiveQuery && (
                    <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-400 italic flex items-center gap-1">
                      <Search className="h-3 w-3 text-blue-400 flex-shrink-0" />
                      Found via: <span className="truncate max-w-xs">{(selectedLead as any).sourceObjectiveQuery}</span>
                    </div>
                  )}
                  {selectedLead.monitorId && (
                    <div className="mt-1.5 flex items-center gap-1.5">
                      <Badge variant="outline" className="text-[10px] text-emerald-700 bg-emerald-50 border-emerald-300 dark:bg-emerald-950/40 dark:text-emerald-300 gap-1">
                        <Activity className="h-3 w-3 animate-pulse text-emerald-500" />
                        Parallel Live Monitor Active
                      </Badge>
                    </div>
                  )}
                </div>
              </div>
              <Button variant="ghost" size="icon" onClick={() => setSelectedLead(null)}>
                <X className="h-5 w-5 text-slate-400" />
              </Button>
            </div>

            {/* Drawer Body */}
            <div className="p-6 space-y-6 flex-1">
              {/* Score Breakdown */}
              <Card className="border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-850">
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base flex items-center gap-2">
                      <Zap className="h-4 w-4 text-amber-500" /> Lead Score Breakdown
                    </CardTitle>
                    <div className="flex items-center gap-2">
                      <span className="text-2xl font-black text-slate-900 dark:text-slate-100">{selectedLead.score?.total || 0}</span>
                      <span className="text-xs text-slate-400">/ 100</span>
                      <Badge variant={(selectedLead.score?.tier || "hot") as any} className="capitalize ml-1">{selectedLead.score?.tier || "hot"}</Badge>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  {[
                    { label: "Fit (Firmographics & Domain)", value: selectedLead.score?.fit || 0, max: 40, color: "bg-blue-600" },
                    { label: "Intent & Buying Signals", value: selectedLead.score?.intent || 0, max: 30, color: "bg-emerald-500" },
                    { label: "Reachability & Accessibility", value: selectedLead.score?.reachability || 0, max: 30, color: "bg-indigo-500" }
                  ].map((bar) => (
                    <div key={bar.label}>
                      <div className="flex justify-between text-xs mb-1">
                        <span className="font-medium text-slate-600 dark:text-slate-300">{bar.label}</span>
                        <span className="font-bold">{bar.value} / {bar.max}</span>
                      </div>
                      <div className="h-2 w-full rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden">
                        <div className={`h-full ${bar.color} rounded-full`} style={{ width: `${(bar.value / bar.max) * 100}%` }} />
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>

              {/* Why This Company */}
              <div className="space-y-3">
                <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                  <Target className="h-4 w-4 text-blue-600" /> Why This Company?
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
                    <span className="text-[11px] font-bold text-amber-800 dark:text-amber-300 uppercase tracking-wide">⚡ Why Now Trigger</span>
                    <p className="text-xs text-amber-900 dark:text-amber-200 mt-1">{selectedLead.score.whyNow}</p>
                  </div>
                )}
                {selectedLead.score?.pitchAngle && (
                  <div className="p-3 rounded-lg bg-blue-50/50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-900/60">
                    <span className="text-[11px] font-bold text-blue-800 dark:text-blue-300 uppercase tracking-wide">🎯 Recommended Pitch Angle</span>
                    <p className="text-xs text-blue-900 dark:text-blue-200 mt-1">{selectedLead.score.pitchAngle}</p>
                  </div>
                )}
              </div>

              {/* FindAll structured attributes */}
              {selectedLead.findallAttributes && Object.keys(selectedLead.findallAttributes).length > 0 && (
                <div className="space-y-2">
                  <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                    <Building className="h-4 w-4 text-blue-600" /> FindAll Enrichment
                  </h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {Object.entries(selectedLead.findallAttributes).map(([key, value]) => (
                      <div key={key} className="p-2.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-850">
                        <div className="text-[10px] uppercase tracking-wide text-slate-400 font-semibold">{key.replace(/_/g, " ")}</div>
                        <div className="text-xs text-slate-800 dark:text-slate-200 mt-0.5">{String(value)}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Parallel Task API Deep Research */}
              {selectedLead.taskResearch && (
                <div className="space-y-2">
                  <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                    <Sparkles className="h-4 w-4 text-indigo-600" /> Deep Research Signals (Parallel Task API)
                  </h3>
                  <div className="p-3 rounded-lg border border-indigo-200 bg-indigo-50/50 dark:border-indigo-900/60 dark:bg-indigo-950/20 text-xs text-indigo-950 dark:text-indigo-200 whitespace-pre-wrap leading-relaxed">
                    {selectedLead.taskResearch}
                  </div>
                </div>
              )}

              {/* Live Web Evidence */}
              <div className="space-y-3">
                <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                  <Globe className="h-4 w-4 text-emerald-600" /> Live Web Search Evidence
                </h3>
                {selectedLead.enrichment?.results && selectedLead.enrichment.results.length > 0 ? (
                  <div className="space-y-2">
                    {selectedLead.enrichment.results.map((res, idx) => (
                      <div key={idx} className="p-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-800/40 space-y-1.5">
                        <div className="flex items-center justify-between text-xs">
                          <a href={res.url} target="_blank" rel="noopener noreferrer" className="font-medium text-blue-600 hover:underline flex items-center gap-1">
                            {res.title || res.url}<ExternalLink className="h-3 w-3" />
                          </a>
                          {res.publishDate && <span className="text-[11px] text-slate-400">{res.publishDate}</span>}
                        </div>
                        {res.excerpts?.map((exc, eIdx) => (
                          <p key={eIdx} className="text-xs text-slate-600 dark:text-slate-300 italic border-l-2 border-slate-300 dark:border-slate-700 pl-2">"{exc}"</p>
                        ))}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-slate-400 italic">No live web search excerpts retrieved.</p>
                )}
              </div>

              {/* Outreach Email */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                    <Mail className="h-4 w-4 text-indigo-600" /> Personalized Outreach Email
                  </h3>
                  <div className="flex items-center gap-1">
                    <span className="text-[11px] text-slate-400 mr-1">Regenerate:</span>
                    {(["formal", "friendly", "short"] as const).map((tone) => (
                      <button key={tone} type="button" disabled={isRegenerating} onClick={() => handleRegenerateOutreach(tone)} className="px-2 py-0.5 rounded text-[11px] border border-slate-200 hover:bg-slate-100 dark:border-slate-700 cursor-pointer capitalize">
                        {tone}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="p-4 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900 space-y-3">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-slate-600 dark:text-slate-400">Subject:</span>
                    <button type="button" onClick={() => copyToClipboard(selectedLead.outreach?.subject || "", "subject")} className="text-blue-600 hover:underline flex items-center gap-1 text-[11px] cursor-pointer">
                      {copiedField === "subject" ? <><Check className="h-3 w-3 text-emerald-600" /> Copied!</> : <><Copy className="h-3 w-3" /> Copy Subject</>}
                    </button>
                  </div>
                  <div className="text-xs font-medium text-slate-900 dark:text-slate-100">{selectedLead.outreach?.subject || "Partnership Opportunity"}</div>
                  <div className="border-t border-slate-200 dark:border-slate-800 pt-2 flex items-center justify-between text-xs">
                    <span className="font-semibold text-slate-600 dark:text-slate-400">Body:</span>
                    <button type="button" onClick={() => copyToClipboard(selectedLead.outreach?.email || "", "email")} className="text-blue-600 hover:underline flex items-center gap-1 text-[11px] cursor-pointer">
                      {copiedField === "email" ? <><Check className="h-3 w-3 text-emerald-600" /> Copied!</> : <><Copy className="h-3 w-3" /> Copy Email</>}
                    </button>
                  </div>
                  <pre className="text-xs text-slate-700 dark:text-slate-300 font-sans whitespace-pre-wrap leading-relaxed">{selectedLead.outreach?.email || "Drafting outreach..."}</pre>
                </div>
                {selectedLead.outreach?.linkedinNote && (
                  <div className="p-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-1.5">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-semibold text-slate-600 dark:text-slate-400">LinkedIn Connection Note (≤300 chars):</span>
                      <button type="button" onClick={() => copyToClipboard(selectedLead.outreach?.linkedinNote || "", "linkedin")} className="text-blue-600 hover:underline flex items-center gap-1 text-[11px] cursor-pointer">
                        {copiedField === "linkedin" ? <><Check className="h-3 w-3 text-emerald-600" /> Copied!</> : <><Copy className="h-3 w-3" /> Copy</>}
                      </button>
                    </div>
                    <p className="text-xs text-slate-700 dark:text-slate-300">"{selectedLead.outreach.linkedinNote}"</p>
                  </div>
                )}
              </div>

              {/* Notes */}
              <div className="space-y-3 pt-4 border-t border-slate-200 dark:border-slate-800">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                    <FileText className="h-4 w-4 text-slate-600" /> Internal Notes
                  </h3>
                  <Button size="sm" variant="secondary" onClick={handleSaveNotes} className="h-7 text-xs">Save Notes</Button>
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
