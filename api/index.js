// Vercel serverless entry point.
// Reuses the exact same routes/controllers/services from ../server — nothing
// there was duplicated or rewritten. This file just adapts the Express app to
// run as a single Vercel Function instead of a long-lived `app.listen()` server.
//
// vercel.json rewrites every /api/* request to this function while keeping the
// original path, so Express's own /api/... routing below still works unchanged.
import express from "express";
import cors from "cors";

import candidatesRoutes from "../server/routes/candidates.js";
import voteRoutes from "../server/routes/vote.js";
import adminRoutes from "../server/routes/admin.js";

const app = express();

app.use(cors());
app.use(express.json());

app.get("/api/health", (req, res) => res.json({ ok: true }));

app.use("/api/candidates", candidatesRoutes);
app.use("/api/vote", voteRoutes);
app.use("/api/admin", adminRoutes);

app.use((req, res) => res.status(404).json({ error: "Not found" }));

// No app.listen() here — Vercel calls this exported handler per-request.
export default app;
