import express from "express";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

import candidatesRoutes from "./routes/candidates.js";
import voteRoutes from "./routes/vote.js";
import adminRoutes from "./routes/admin.js";

const app = express();

app.use(cors());
app.use(express.json());

app.get("/api/health", (req, res) => res.json({ ok: true }));

app.use("/api/candidates", candidatesRoutes);
app.use("/api/vote", voteRoutes);
app.use("/api/admin", adminRoutes);

app.use((req, res) => res.status(404).json({ error: "Not found" }));

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`CR Election server running on http://localhost:${PORT}`);
});
