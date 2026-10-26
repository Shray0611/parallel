import { app } from "./app.js";
import { env } from "./config/env.js";
import { connectDB } from "./config/db.js";
import { ensureDemoUser } from "./demo/seedUser.js";
import { logger } from "./config/logger.js";

async function startServer() {
  await connectDB();
  await ensureDemoUser();

  const server = app.listen(env.PORT, () => {
    logger.info(`🚀 Cerelabs LeadScope Backend running on port ${env.PORT} (DEMO_MODE=${env.DEMO_MODE})`);
  });

  const shutdown = () => {
    logger.info("Gracefully shutting down backend server...");
    server.close(() => {
      logger.info("Server closed.");
      process.exit(0);
    });
  };

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

startServer().catch((err) => {
  logger.error({ err }, "Fatal startup error");
  process.exit(1);
});
