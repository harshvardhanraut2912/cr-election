import { Router } from "express";
import { adminAuth } from "../middleware/adminAuth.js";
import { addCandidate, editCandidate, removeCandidate } from "../controllers/candidatesController.js";
import { clearSubmissionData, adminLookupStudent, adminCastVote } from "../controllers/voteController.js";
import { setQrDisplay } from "../controllers/displayController.js";
import { startVoting, extendVoting, endVoting } from "../controllers/votingController.js";

const router = Router();
router.use(adminAuth);

router.post("/candidates", addCandidate);
router.put("/candidates/:category/:candidateId", editCandidate);
router.delete("/candidates/:category/:candidateId", removeCandidate);
router.delete("/submissions", clearSubmissionData);
router.post("/vote/lookup", adminLookupStudent);
router.post("/vote/cast", adminCastVote);
router.put("/display/qr", setQrDisplay);
router.post("/voting/start", startVoting);
router.post("/voting/extend", extendVoting);
router.post("/voting/end", endVoting);

export default router;
