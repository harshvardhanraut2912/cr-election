import { Router } from "express";
import { getCandidates } from "../controllers/candidatesController.js";

const router = Router();
router.get("/", getCandidates);

export default router;
