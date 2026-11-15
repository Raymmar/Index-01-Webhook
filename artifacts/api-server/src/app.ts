import express, { type Express, type ErrorRequestHandler } from "express";
import { clerkMiddleware } from "@clerk/express";
import { publishableKeyFromHost } from "@clerk/shared/keys";
import { CLERK_PROXY_PATH, clerkProxyMiddleware, getClerkProxyHost } from "./middlewares/clerkProxyMiddleware";
import receiveRouter from "./routes/receive";
import inboxRouter from "./routes/inbox";
import organizerRouter from "./routes/organizer";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { mobileCors } from "./middlewares/mobileCors";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(CLERK_PROXY_PATH, clerkProxyMiddleware());
app.use("/api", mobileCors);
// Ring traffic has its own bearer authentication, not a browser Clerk session.
app.use("/api", receiveRouter);
app.use(express.json({ limit: "512kb" }));
app.use(clerkMiddleware((req) => ({
  publishableKey: publishableKeyFromHost(getClerkProxyHost(req) ?? "", process.env.CLERK_PUBLISHABLE_KEY),
})));
app.use("/api", router);
app.use("/api", organizerRouter);
app.use("/api", inboxRouter);
const errors: ErrorRequestHandler = (err, req, res, _next) => {
  const status = err.code === "LIMIT_FILE_SIZE" || err.type === "entity.too.large" ? 413
    : err.name === "MulterError" || err.type === "entity.parse.failed" ? 400 : 500;
  req.log.error({ errorType: err.name, status }, "Request failed");
  res.status(status).json({ error: status === 413 ? "Upload exceeds the size limit (audio 25 MB, JSON 512 KB)" : status === 400 ? "Malformed payload or unexpected upload field" : "Unable to complete the request" });
};
app.use(errors);

export default app;
