import bcrypt from "bcryptjs";
import { User, IUser } from "../models/User.js";
import { logger } from "../config/logger.js";
import { isDbConnected } from "../config/db.js";

export const DEMO_USER_EMAIL = "demo@cerelabs.ai";
export const DEMO_USER_PASSWORD = "Demo@1234";

// In-memory fallback if MongoDB is not running locally
export const inMemoryUsers: Map<string, { id: string; email: string; passwordHash: string; name: string; role: "sales" | "marketing" | "admin" }> = new Map();

export async function ensureDemoUser(): Promise<void> {
  const salt = await bcrypt.genSalt(10);
  const passwordHash = await bcrypt.hash(DEMO_USER_PASSWORD, salt);

  // Always seed in-memory store
  inMemoryUsers.set(DEMO_USER_EMAIL, {
    id: "demo-user-12345",
    email: DEMO_USER_EMAIL,
    passwordHash,
    name: "Cerelabs Demo",
    role: "sales"
  });

  if (!isDbConnected()) {
    logger.info("Demo user available in memory fallback");
    return;
  }

  try {
    const existing = await User.findOne({ email: DEMO_USER_EMAIL });
    if (!existing) {
      await User.create({
        email: DEMO_USER_EMAIL,
        passwordHash,
        name: "Cerelabs Demo",
        role: "sales"
      });
      logger.info("Demo user seeded in MongoDB: demo@cerelabs.ai");
    }
  } catch (err) {
    logger.warn({ err }, "Could not seed demo user in MongoDB; using fallback");
  }
}
