export interface SearchObjective {
  domain?: string;
  objective: string;
  rationale: string;
  queries?: string[];
  country?: string;
  city?: string;
}

export interface IcpData {
  summary: string;
  painPoints: string[];
  buyerPersonas: string[];
  disqualifiers: string[];
}

export interface CampaignFilters {
  country: string;
  city?: string;
  companySize: "1-50" | "51-200" | "201-1000" | "1001-5000" | "5000+";
  domains: string[];
}

export interface CampaignStats {
  found: number;
  enriched: number;
  scored: number;
  hot: number;
  warm: number;
  cold: number;
  apiCalls: {
    gemini?: number;
    groq?: number;
    parallelEntity: number;
    parallelSearch: number;
    parallelFindAll?: number;
    parallelExtract?: number;
    parallelTask?: number;
    parallelMonitor?: number;
  };
}

export interface CampaignProgress {
  stage: "icp" | "discover" | "enrich" | "score" | "completed" | "failed";
  current: number;
  total: number;
  message: string;
}

export interface Campaign {
  _id: string;
  id?: string;
  userId: string;
  title: string;
  offering: string;
  valueProps: string[];
  filters: CampaignFilters;
  icp?: IcpData;
  searchObjectives?: SearchObjective[];
  findallRunIds?: string[];
  status: "draft" | "running" | "completed" | "failed";
  progress: CampaignProgress;
  stats: CampaignStats;
  sessionId: string;
  createdAt: string;
  completedAt?: string;
}

export interface EnrichmentResult {
  url: string;
  title: string | null;
  publishDate: string | null;
  excerpts: string[];
}

export interface LeadScore {
  total: number;
  fit: number;
  intent: number;
  reachability: number;
  tier: "hot" | "warm" | "cold";
  reasons: string[];
  whyNow: string;
  pitchAngle: string;
  recommendedProduct: string;
  estimatedSize: string;
  industry: string;
  location: string;
  risks: string[];
}

export interface LeadOutreach {
  subject: string;
  email: string;
  linkedinNote: string;
}

export interface Lead {
  _id: string;
  id?: string;
  campaignId: string;
  name: string;
  website: string;
  domain: string;
  description: string;
  sourceObjectiveIndex: number;
  sourceObjectiveQuery?: string;
  extractedSummary?: string;
  websiteExtract?: {
    url: string;
    title?: string;
    publishDate?: string | null;
    excerpts: string[];
  };
  taskResearch?: string;
  taskRunId?: string;
  monitorId?: string;
  findallAttributes?: Record<string, string | number | boolean>;
  enrichment?: {
    results: EnrichmentResult[];
    fetchedAt: string;
    searchId?: string;
  };
  score?: LeadScore;
  outreach?: LeadOutreach;
  status: "new" | "contacted" | "replied" | "qualified" | "lost";
  notes: string;
  assignedTo?: string;
  createdAt: string;
  updatedAt: string;
}
