import app from "./app";
import { logger } from "./lib/logger";
import { startUnderstandingWorker } from "./lib/understanding-worker";
import { startMessageDispatcher } from "./lib/message-dispatcher";
import { startReviewWorker } from "./lib/review-worker";
import { migrateUnifiedItems } from "./lib/unified-items";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

await migrateUnifiedItems();
app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
  startUnderstandingWorker();
  startMessageDispatcher();
  startReviewWorker();
});
