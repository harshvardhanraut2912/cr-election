import { Router } from "express";
import { lookupStudent, validateVoter, castVote } from "../controllers/voteController.js";

const router = Router();
router.post("/lookup", lookupStudent);
router.post("/validate", validateVoter);
router.post("/cast", castVote);

export default router;
