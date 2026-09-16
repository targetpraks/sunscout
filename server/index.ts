import "dotenv/config";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { requireUser } from "./auth";
import { accuracyRouter } from "./accuracy";
import { bookingsRouter } from "./bookings";
import { captureException } from "./errorTracking";
import { pool } from "./db";
import { migrate } from "./migrate";
import { requireInstitutionMember } from "./institutions";
import { paymentsConfigured } from "./payments";
import { pillarsRouter } from "./pillarsRouter";
import { pushConfigured } from "./push";
import { vibesRouter } from "./vibes";
import { analyticsRouter } from "./routes/analytics";
import { beachesRouter } from "./routes/beaches";
import { bookingsCoreRouter } from "./routes/bookings";
import { checkinsRouter } from "./routes/checkins";
import { conditionsRouter } from "./routes/conditions";
import { hazardsRouter } from "./routes/hazards";
import {
  institutionPortalRouter,
  institutionPublicRouter,
} from "./routes/institution";
import { meRouter } from "./routes/me";
import { merchantRouter } from "./routes/merchant";

const app = express();
const port = Number(process.env.API_PORT ?? 8787);

const isHttps =
  process.env.NODE_ENV === "production" && !!process.env.FORCE_HTTPS;
app.use(
  helmet({
    crossOriginResourcePolicy: false,
    // Only force HTTPS upgrades when actually serving over HTTPS —
    // on plain-HTTP LAN deployments it silently blocks module scripts.
    contentSecurityPolicy: isHttps ? undefined : false,
  }),
);
app.use(
  cors({
    origin: ["http://127.0.0.1:5173", "http://localhost:5173"],
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  }),
);
app.use(express.json({ limit: "256kb" }));

// Serve built frontend (production)
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.resolve(__dirname, "../dist");
if (process.env.NODE_ENV === "production") {
  app.use(express.static(distDir));
  app.get(/^\/(?!api\/).*/, (_req, res) => {
    res.sendFile(path.join(distDir, "index.html"));
  });
}

app.get("/api/health", async (_request, response) => {
  const result = await pool.query<{ now: string }>("select now()");
  response.json({ status: "ok", databaseTime: result.rows[0].now });
});

// Community + pillar routers mount BEFORE the /api/beaches/:slug catch-all
// below so the deeper community paths (/api/beaches/:id/vibes, :id/pulse,
// :id/sightings) win registration-order matching over the detail route.
app.use("/api", vibesRouter);
app.use(pillarsRouter);

// Beach-scoped routes (list, detail, feedback, spotter campaign, concierge,
// crowd forecast, rate/rating, report, community data, day quality).
// Mounted at the original position of GET /api/beaches — after the
// vibes/pillars community routers, before the auth prefix mounts.
app.use(beachesRouter);

app.use("/api/me", requireUser);
app.use("/api/check-ins", requireUser);
app.use("/api/bookings", requireUser);
app.use("/api/events", requireUser);
app.use("/api/conditions", requireUser);

app.use("/api/merchant", requireUser);

// Families gated by the prefix mounts above (plus /api/providers, which
// no prefix mount covers and therefore stays public, as before).
app.use(conditionsRouter);
app.use(merchantRouter);
app.use(meRouter);
app.use(checkinsRouter);
app.use(bookingsCoreRouter);

// === BEGIN HOTSPOT (burst/sunscout-1-ship-booking-self-service-cancel): booking lifecycle router ===
// Self-service cancel (POST /:bookingPublicId/cancel, full >24h / 50% 2-24h /
// none <2h refund policy) and receipt (GET /:bookingPublicId/receipt).
// Supersedes the former inline cancel handler (which used the older
// 24h/0h billing policy). Owner scoping is inherited from the
// app.use("/api/bookings", requireUser) middleware mounted earlier.
app.use("/api/bookings", bookingsRouter);
// === END HOTSPOT (burst/sunscout-1-ship-booking-self-service-cancel) ===

// Public (no prefix gate covers /api/hazards — matches original).
app.use(hazardsRouter);

// Condition-accuracy feedback loop (PRD 6.1): rate the data, feed Beach Pulse.
// POST is auth-scoped inside the router; the aggregate GET is public.
app.use("/api/accuracy", accuracyRouter);

// /api/institution/trends + /api/embed/:token stay PUBLIC: registered
// before the /api/institution auth mount below, as in the original.
app.use(institutionPublicRouter);

app.use("/api/institution", requireUser, requireInstitutionMember);

// /api/institution/dashboard + export — gated by the mount above.
app.use(institutionPortalRouter);

// POST /api/events (analytics ingest) — gated by the /api/events mount.
app.use(analyticsRouter);

app.get("/api/ops/status", async (_request, response) => {
  const started = (process.uptime?.() ?? 0) * 1000;
  const beachCount = await pool.query("select count(*)::int as n from beach");
  const hazardCount = await pool.query(
    "select count(*)::int as n from hazard_alert where expires_at is null or expires_at > now()",
  );
  response.json({
    data: {
      status: "operational",
      uptime_seconds: Math.round(started / 1000),
      payments_configured: paymentsConfigured(),
      push_configured: pushConfigured(),
      auth_adapter_configured: authAdapterConfiguredSafe(),
      error_tracking_configured: Boolean(process.env.SENTRY_DSN),
      beaches: beachCount.rows[0].n,
      active_hazards: hazardCount.rows[0].n,
    },
  });
});

function authAdapterConfiguredSafe(): boolean {
  return Boolean(process.env.SUNSCOUT_JWKS_URL);
}

app.use(
  (
    error: unknown,
    _request: express.Request,
    response: express.Response,
    _next: express.NextFunction,
  ) => {
    if (error instanceof z.ZodError) {
      response
        .status(400)
        .json({ error: "invalid_request", issues: error.issues });
      return;
    }
    const status =
      typeof error === "object" && error && "status" in error
        ? Number(error.status)
        : 500;
    console.error(error);
    if (status >= 500) void captureException(error, { path: _request.path });
    response.status(status).json({
      error: error instanceof Error ? error.message : "internal_error",
    });
  },
);

// Run migrations on boot (idempotent) — ensures fresh DBs have schema
migrate()
  .then(() => {
    console.log("Migrations up to date");
    app.listen(port, "0.0.0.0", () => {
      console.log(`SunScout API listening at http://0.0.0.0:${port}`);
    });
  })
  .catch((error) => {
    console.error("Migration failed", error);
    process.exit(1);
  });
