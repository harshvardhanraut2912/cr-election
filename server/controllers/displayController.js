import { db, FieldValue } from "../services/firebaseAdmin.js";

export async function setQrDisplay(req, res) {
  try {
    const showQr = Boolean(req.body?.showQr);
    await db.collection("settings").doc("display").set(
      { showQr, updatedAt: FieldValue.serverTimestamp() },
      { merge: true }
    );
    res.json({ ok: true, showQr });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to update QR display setting" });
  }
}

// Admin toggle: when on, a student may cast a vote for only a Boys CR, only
// a Girls CR, or both (castVote in voteController.js enforces "at least
// one"). When off (default), a student must vote for exactly one of each,
// same as the original behavior.
export async function setFlexibleVoting(req, res) {
  try {
    const flexibleVoting = Boolean(req.body?.flexibleVoting);
    await db.collection("settings").doc("display").set(
      { flexibleVoting, updatedAt: FieldValue.serverTimestamp() },
      { merge: true }
    );
    res.json({ ok: true, flexibleVoting });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to update voting mode setting" });
  }
}
