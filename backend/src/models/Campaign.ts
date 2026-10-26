import mongoose, { Document, Schema } from "mongoose";

export interface ICampaignProgress {
  stage: "icp" | "discover" | "enrich" | "score" | "completed" | "failed";
  current: number;
  total: number;
  message: string;
}

export interface ICampaignStats {
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
  };
}

export interface ISearchObjective {
  objective: string;
  rationale: string;
}

export interface IIcp {
  summary: string;
  painPoints: string[];
  buyerPersonas: string[];
  disqualifiers: string[];
}

export interface ICampaign extends Document {
  userId: string;
  title: string;
  offering: string;
  valueProps: string[];
  filters: {
    country: string; // ISO 2
    city?: string;
    companySize: "1-50" | "51-200" | "201-1000" | "1001-5000" | "5000+";
    domains: string[];
  };
  icp?: IIcp;
  searchObjectives?: ISearchObjective[];
  status: "draft" | "running" | "completed" | "failed";
  progress: ICampaignProgress;
  stats: ICampaignStats;
  sessionId: string;
  createdAt: Date;
  completedAt?: Date;
}

const campaignSchema = new Schema<ICampaign>(
  {
    userId: { type: String, required: true, index: true },
    title: { type: String, required: true, trim: true },
    offering: { type: String, required: true },
    valueProps: { type: [String], default: [] },
    filters: {
      country: { type: String, required: true, default: "IN" },
      city: { type: String },
      companySize: {
        type: String,
        enum: ["1-50", "51-200", "201-1000", "1001-5000", "5000+"],
        required: true,
        default: "51-200"
      },
      domains: { type: [String], default: [] }
    },
    icp: {
      summary: { type: String },
      painPoints: { type: [String], default: [] },
      buyerPersonas: { type: [String], default: [] },
      disqualifiers: { type: [String], default: [] }
    },
    searchObjectives: [
      {
        objective: { type: String, required: true },
        rationale: { type: String, required: true }
      }
    ],
    status: {
      type: String,
      enum: ["draft", "running", "completed", "failed"],
      default: "draft",
      index: true
    },
    progress: {
      stage: {
        type: String,
        enum: ["icp", "discover", "enrich", "score", "completed", "failed"],
        default: "icp"
      },
      current: { type: Number, default: 0 },
      total: { type: Number, default: 0 },
      message: { type: String, default: "Initialized" }
    },
    stats: {
      found: { type: Number, default: 0 },
      enriched: { type: Number, default: 0 },
      scored: { type: Number, default: 0 },
      hot: { type: Number, default: 0 },
      warm: { type: Number, default: 0 },
      cold: { type: Number, default: 0 },
      apiCalls: {
        gemini: { type: Number, default: 0 },
        groq: { type: Number, default: 0 },
        parallelEntity: { type: Number, default: 0 },
        parallelSearch: { type: Number, default: 0 }
      }
    },
    sessionId: { type: String, required: true },
    completedAt: { type: Date }
  },
  {
    timestamps: true
  }
);

export const Campaign = mongoose.model<ICampaign>("Campaign", campaignSchema);
