import mongoose, { Document, Schema } from "mongoose";

export interface IApiCache extends Document {
  key: string;
  provider: "groq" | "parallel_entity" | "parallel_search";
  response: any;
  createdAt: Date;
}

const apiCacheSchema = new Schema<IApiCache>(
  {
    key: { type: String, required: true, unique: true, index: true },
    provider: {
      type: String,
      enum: ["groq", "parallel_entity", "parallel_search"],
      required: true
    },
    response: { type: Schema.Types.Mixed, required: true },
    createdAt: {
      type: Date,
      default: Date.now,
      expires: 60 * 60 * 24 * 7 // 7 days TTL index
    }
  }
);

export const ApiCache = mongoose.model<IApiCache>("ApiCache", apiCacheSchema);
