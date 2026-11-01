import mongoose, { Document, Schema } from "mongoose";

export interface IEnrichmentResult {
  url: string;
  title: string | null;
  publishDate: string | null;
  excerpts: string[];
}

export interface ILeadEnrichment {
  results: IEnrichmentResult[];
  fetchedAt: Date;
  searchId?: string;
}

export interface ILeadScore {
  total: number; // 0-100
  fit: number; // 0-40
  intent: number; // 0-30
  reachability: number; // 0-30
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

export interface ILeadOutreach {
  subject: string;
  email: string;
  linkedinNote: string;
}

export interface ILead extends Document {
  campaignId: string;
  name: string;
  website: string;
  domain: string;
  description: string;
  sourceObjectiveIndex: number;
  sourceObjectiveQuery?: string;
  extractedSummary?: string;
  taskResearch?: string;
  taskRunId?: string;
  monitorId?: string;
  findallAttributes?: Record<string, any>;
  enrichment?: ILeadEnrichment;
  score?: ILeadScore;
  outreach?: ILeadOutreach;
  status: "new" | "contacted" | "replied" | "qualified" | "lost";
  notes: string;
  assignedTo?: string;
  createdAt: Date;
  updatedAt: Date;
}

const leadSchema = new Schema<ILead>(
  {
    campaignId: { type: String, required: true, index: true },
    name: { type: String, required: true, trim: true },
    website: { type: String, required: true, trim: true },
    domain: { type: String, required: true, trim: true, index: true },
    description: { type: String, default: "" },
    sourceObjectiveIndex: { type: Number, default: 0 },
    sourceObjectiveQuery: { type: String, default: '' },
    extractedSummary: { type: String, default: '' },
    taskResearch: { type: String, default: '' },
    taskRunId: { type: String, default: '' },
    monitorId: { type: String, default: '' },
    findallAttributes: { type: Schema.Types.Mixed, default: {} },
    enrichment: {
      results: [
        {
          url: { type: String, required: true },
          title: { type: String, default: null },
          publishDate: { type: String, default: null },
          excerpts: { type: [String], default: [] }
        }
      ],
      fetchedAt: { type: Date, default: Date.now },
      searchId: { type: String }
    },
    score: {
      total: { type: Number, min: 0, max: 100 },
      fit: { type: Number, min: 0, max: 40 },
      intent: { type: Number, min: 0, max: 30 },
      reachability: { type: Number, min: 0, max: 30 },
      tier: { type: String, enum: ["hot", "warm", "cold"] },
      reasons: { type: [String], default: [] },
      whyNow: { type: String, default: "" },
      pitchAngle: { type: String, default: "" },
      recommendedProduct: { type: String, default: "" },
      estimatedSize: { type: String, default: "" },
      industry: { type: String, default: "" },
      location: { type: String, default: "" },
      risks: { type: [String], default: [] }
    },
    outreach: {
      subject: { type: String, default: "" },
      email: { type: String, default: "" },
      linkedinNote: { type: String, default: "" }
    },
    status: {
      type: String,
      enum: ["new", "contacted", "replied", "qualified", "lost"],
      default: "new",
      index: true
    },
    notes: { type: String, default: "" },
    assignedTo: { type: String }
  },
  {
    timestamps: true
  }
);

// Unique index on (campaignId, domain) to dedupe across objectives
leadSchema.index({ campaignId: 1, domain: 1 }, { unique: true });

export const Lead = mongoose.model<ILead>("Lead", leadSchema);
