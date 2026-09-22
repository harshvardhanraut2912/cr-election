import { Router } from "express";
import { adminAuth } from "../middleware/adminAuth.js";
import { addCandidate, editCandidate, removeCandidate } from "../controllers/candidatesController.js";

const router = Router();
router.use(adminAuth);

router.post("/candidates", addCandidate);
router.put("/candidates/:category/:candidateId", editCandidate);
router.delete("/candidates/:category/:candidateId", removeCandidate);

export default router;
