import mongoose from "mongoose";
import { env } from "./env.js";
import { logger } from "./logger.js";

let isConnected = false;

export async function connectDB(): Promise<boolean> {
  if (isConnected) return true;

  try {
    await mongoose.connect(env.MONGODB_URI, {
      serverSelectionTimeoutMS: 3000
    });
    isConnected = true;
    logger.info("Connected to MongoDB successfully");
    return true;
  } catch (error) {
    logger.warn({ err: error }, "Failed to connect to MongoDB. Continuing (will retry on next request or mock in demo mode)");
    return false;
  }
}

export function isDbConnected(): boolean {
  return mongoose.connection.readyState === 1;
}
