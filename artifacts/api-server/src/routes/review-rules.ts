import { Router, type RequestHandler } from "express";
import { db, reviewRulesTable as rules, reviewRunsTable as runs } from "@workspace/db";
import { and, desc, eq, lt, sql } from "drizzle-orm";
import { CreateReviewRuleBody, UpdateReviewRuleBody, UpdateReviewOverviewBody, ListReviewRulesResponse, ListReviewRunsResponse, ListReviewRunsQueryParams } from "@workspace/api-zod";
import { ReviewError, saveReviewRule, ruleResponse, runResponse, ownerLock, ownedRule, notifyReview, enqueueReview, undoReview } from "../lib/review-rules";

const router = Router();
// Mounted after organizer's Clerk/account access checks.
const handle = (fn: RequestHandler): RequestHandler => async (req, res, next) => {
  try { await fn(req, res, next); }
  catch (error) { if (error instanceof ReviewError) res.status(error.status).json({ error: error.message }); else next(error); }
};
const idOf = (value: string | string[]) => Array.isArray(value) ? value[0] : value;

router.get("/rules", handle(async (_req, res) => {
  const rows = await db.select().from(rules).where(eq(rules.ownerId, res.locals.ownerId)).orderBy(rules.createdAt);
  res.json(ListReviewRulesResponse.parse(rows));
}));
router.post("/rules", handle(async (req, res) => {
  const body = CreateReviewRuleBody.safeParse(req.body);
  if (!body.success) throw new ReviewError("Check the rule fields, timing, and prompt length.");
  res.status(201).json(ruleResponse(await saveReviewRule(res.locals.ownerId, undefined, body.data)));
}));
router.get("/rules/:id", handle(async (req, res) => {
  const rule = await db.transaction(tx => ownedRule(tx, res.locals.ownerId, idOf(req.params.id)));
  res.json(ruleResponse(rule));
}));
router.put("/rules/:id", handle(async (req, res) => {
  const body = UpdateReviewRuleBody.safeParse(req.body);
  if (!body.success) throw new ReviewError("Check the rule fields, timing, and prompt length.");
  res.json(ruleResponse(await saveReviewRule(res.locals.ownerId, idOf(req.params.id), body.data)));
}));
router.delete("/rules/:id", handle(async (req, res) => {
  await db.transaction(async tx => {
    const owner = res.locals.ownerId, id = idOf(req.params.id);
    await ownerLock(tx, owner); await ownedRule(tx, owner, id);
    const dependents = await tx.select().from(rules).where(and(eq(rules.ownerId, owner), sql`${rules.inputRuleIds} @> ${JSON.stringify([id])}::jsonb`));
    if (dependents.length) throw new ReviewError("Another rule uses this rule's output. Remove that input first.", 409);
    await tx.delete(runs).where(eq(runs.ruleId, id));
    await tx.delete(rules).where(eq(rules.id, id));
    await notifyReview(tx, owner);
  });
  res.sendStatus(204);
}));
router.get("/rules/:id/runs", handle(async (req, res) => {
  const params = ListReviewRunsQueryParams.safeParse(req.query);
  if (!params.success) throw new ReviewError("Invalid history cursor.");
  const id = idOf(req.params.id), owner = res.locals.ownerId;
  await db.transaction(tx => ownedRule(tx, owner, id));
  const rows = await db.select().from(runs).where(and(eq(runs.ruleId, id), eq(runs.ownerId, owner),
    params.data.before ? lt(runs.createdAt, params.data.before) : undefined)).orderBy(desc(runs.createdAt), desc(runs.id)).limit(50);
  res.json(ListReviewRunsResponse.parse(rows.map(runResponse)));
}));
router.post("/rules/:id/runs", handle(async (req, res) => {
  const run = await db.transaction(async tx => {
    const owner = res.locals.ownerId;
    await ownerLock(tx, owner);
    const rule = await ownedRule(tx, owner, idOf(req.params.id)), now = new Date();
    // Explicit Run now works even when scheduled execution is disabled.
    return enqueueReview(tx, rule, new Date(now.getTime() - rule.lookbackHours * 3_600_000), now);
  });
  res.status(202).json(runResponse(run));
}));
router.put("/rules/:id/overview", handle(async (req, res) => {
  const body = UpdateReviewOverviewBody.safeParse(req.body);
  if (!body.success) throw new ReviewError("Overview must be text of at most 24,000 characters.");
  const rule = await db.transaction(async tx => {
    const owner = res.locals.ownerId;
    await ownerLock(tx, owner);
    const current = await ownedRule(tx, owner, idOf(req.params.id));
    if (current.revision !== body.data.revision) throw new ReviewError("This rule changed on another device. Reload before saving.", 409);
    const now = new Date();
    // An editable revision remains in the same history as generated overviews.
    await tx.insert(runs).values({ id: crypto.randomUUID(), ruleId: current.id, ownerId: owner, ruleRevision: current.revision,
      status: "completed", report: body.data.text, completedAt: now, windowStart: now, windowEnd: now });
    const [updated] = await tx.update(rules).set({ overview: body.data.text, overviewUpdatedAt: now, updatedAt: now, revision: current.revision + 1 }).where(eq(rules.id, current.id)).returning();
    await tx.update(runs).set({ status: "cancelled", leaseId: null, completedAt: now, error: "Overview edited; run cancelled." })
      .where(and(eq(runs.ruleId, current.id), sql`${runs.status} IN ('pending','waiting','processing')`));
    await notifyReview(tx, owner);
    return updated;
  });
  res.json(ruleResponse(rule));
}));
router.post("/rules/:id/runs/:runId/undo", handle(async (req, res) => {
  res.json(runResponse(await undoReview(res.locals.ownerId, idOf(req.params.id), idOf(req.params.runId))));
}));
export default router;
