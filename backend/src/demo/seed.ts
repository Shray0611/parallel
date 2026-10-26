import { connectDB } from "../config/db.js";
import { ensureDemoUser, DEMO_USER_EMAIL } from "./seedUser.js";
import { User } from "../models/User.js";
import { Campaign } from "../models/Campaign.js";
import { Lead } from "../models/Lead.js";
import { logger } from "../config/logger.js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const fixturesPath = path.resolve(__dirname, "./fixtures.json");
const fixturesData: any[] = JSON.parse(fs.readFileSync(fixturesPath, "utf-8"));

async function seed() {
  logger.info("🌱 Starting database seed script...");
  await connectDB();
  await ensureDemoUser();

  const user = await User.findOne({ email: DEMO_USER_EMAIL });
  if (!user) {
    logger.error("Demo user could not be found or created. Aborting seed.");
    process.exit(1);
  }

  const userId = user._id.toString();

  // Check if demo campaign already exists
  const existingCampaign = await Campaign.findOne({ userId, title: "Enterprise RAG & Document AI Pipeline" });
  if (existingCampaign) {
    logger.info("Demo campaign already seeded. Checking lead counts...");
    const leadCount = await Lead.countDocuments({ campaignId: existingCampaign._id.toString() });
    logger.info(`Existing demo campaign has ${leadCount} leads.`);
    process.exit(0);
  }

  logger.info("Creating initial completed DEMO campaign...");
  const campaign = await Campaign.create({
    userId,
    title: "Enterprise RAG & Document AI Pipeline",
    offering: "Enterprise RAG pipelines and multimodal document intelligence for automated compliance, contract due diligence, and technical diagnostic queries.",
    valueProps: [
      "Sub-second semantic search over 100,000+ internal documents and SOPs",
      "Zero-hallucination citation-backed answers with exact page references",
      "VPC-isolated and air-gapped deployment with strict data residency"
    ],
    filters: {
      country: "IN",
      companySize: "1001-5000",
      domains: ["Pharmaceuticals", "BFSI", "Legal", "Logistics", "Manufacturing"]
    },
    icp: {
      summary: "Regulated enterprise manufacturers, financial institutions, and law firms in India with vast unstructured documentation and heavy compliance reporting obligations.",
      painPoints: [
        "Weeks spent manually compiling regulatory compliance matrices and audit binders",
        "Slow loan underwriting and title deed verification cycles",
        "Disparate document silos across acquisitions and legacy systems"
      ],
      buyerPersonas: [
        "Chief Information Officer (CIO)",
        "VP of Quality Assurance & Compliance",
        "Head of Digital Transformation"
      ],
      disqualifiers: [
        "Small firms with fewer than 100 employees without regulatory overhead",
        "Non-digital paper-only operations without scanner/PDF workflows"
      ]
    },
    searchObjectives: [
      {
        objective: "Large pharmaceutical and healthcare companies in India (1001-5000 employees) with extensive FDA, CDSCO, and clinical trial documentation",
        rationale: "Target high-value compliance audit automation"
      },
      {
        objective: "Major Indian private banks and NBFCs (1001-5000 employees) processing SME credit, mortgage deeds, and trade finance letters of credit",
        rationale: "Target commercial lending and trade document automation"
      },
      {
        objective: "Top tier Indian corporate law firms and EPC conglomerates (1001-5000 employees) analyzing thousands of contract due diligence documents",
        rationale: "Target M&A virtual data room and EPC tender compliance"
      }
    ],
    status: "completed",
    progress: {
      stage: "completed",
      current: 5,
      total: 5,
      message: "Completed demo run with 25 realistic enterprise prospects"
    },
    stats: {
      found: fixturesData.length,
      enriched: fixturesData.length,
      scored: fixturesData.length,
      hot: fixturesData.filter((f) => f.score.tier === "hot").length,
      warm: fixturesData.filter((f) => f.score.tier === "warm").length,
      cold: fixturesData.filter((f) => f.score.tier === "cold").length,
      apiCalls: {
        groq: fixturesData.length + 1,
        parallelEntity: 3,
        parallelSearch: fixturesData.length
      }
    },
    sessionId: `seed-session-${Date.now()}`,
    completedAt: new Date()
  });

  const campaignId = campaign._id.toString();

  logger.info(`Seeding ${fixturesData.length} enriched leads for demo campaign...`);
  for (let i = 0; i < fixturesData.length; i++) {
    const item = fixturesData[i];
    await Lead.create({
      campaignId,
      name: item.name,
      website: item.website,
      domain: item.domain,
      description: item.description,
      sourceObjectiveIndex: i % 3,
      enrichment: item.enrichment,
      score: item.score,
      outreach: item.outreach,
      status: i === 0 ? "qualified" : i === 1 ? "contacted" : i === 2 ? "replied" : "new",
      notes: i === 0 ? "Initial discovery call scheduled with Head of Digital." : ""
    });
  }

  logger.info("✅ Database seeded successfully with demo user and completed campaign!");
  process.exit(0);
}

seed().catch((err) => {
  logger.error({ err }, "Seed script failed");
  process.exit(1);
});
