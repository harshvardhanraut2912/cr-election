import { Router } from "express";
import { adminAuth } from "../middleware/adminAuth.js";
import { addCandidate, editCandidate, removeCandidate } from "../controllers/candidatesController.js";
import { clearSubmissionData, adminLookupStudent, adminCastVote, adminPlusOneVote } from "../controllers/voteController.js";
import { setQrDisplay, setFlexibleVoting } from "../controllers/displayController.js";
import { startVoting, extendVoting, endVoting } from "../controllers/votingController.js";

const router = Router();
router.use(adminAuth);

// Used by the admin/tv and admin/settings login screens to check a token
// against ADMIN_TOKEN before any admin page is allowed to render or fetch
// anything. adminAuth (above) already rejects a bad/missing token with 401,
// so reaching this handler at all means the token is valid.
router.post("/verify", (req, res) => res.json({ ok: true }));

router.post("/candidates", addCandidate);
router.put("/candidates/:category/:candidateId", editCandidate);
router.delete("/candidates/:category/:candidateId", removeCandidate);
router.delete("/submissions", clearSubmissionData);
router.post("/vote/lookup", adminLookupStudent);
router.post("/vote/cast", adminCastVote);
router.post("/vote/plus-one", adminPlusOneVote);
router.put("/display/qr", setQrDisplay);
router.put("/display/flexible-voting", setFlexibleVoting);
router.post("/voting/start", startVoting);
router.post("/voting/extend", extendVoting);
router.post("/voting/end", endVoting);

export default router;
