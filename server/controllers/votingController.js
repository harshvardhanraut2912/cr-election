import { db, FieldValue } from "../services/firebaseAdmin.js";
import { getVotingDoc, computeVotingPhase, DEFAULT_DURATION_MINUTES } from "../services/votingWindow.js";

// Admin: opens the ballot to students. Resets the 10-minute window and force
// closes the QR overlay on the TV (a plain toggle — admin can switch it back
// on any time, this is just a one-off "clear the screen, voting is live now").
export async function startVoting(req, res) {
  try {
    const batch = db.batch();
    const votingRef = db.collection("settings").doc("voting");
    const displayRef = db.collection("settings").doc("display");

    batch.set(
      votingRef,
      {
        status: "live",
        startedAt: FieldValue.serverTimestamp(),
        durationMinutes: DEFAULT_DURATION_MINUTES,
        endedAt: null,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    batch.set(displayRef, { showQr: false, updatedAt: FieldValue.serverTimestamp() }, { merge: true });

    await batch.commit();
    res.json({ ok: true, durationMinutes: DEFAULT_DURATION_MINUTES });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to start voting" });
  }
}

// Admin: adds one more minute to the window. Only valid while voting is
// live — this is what lets the 10-minute window be stretched in real time.
export async function extendVoting(req, res) {
  try {
    const voting = await getVotingDoc();
    const { phase } = computeVotingPhase(voting);
    if (phase !== "live") {
      return res.status(400).json({ error: "Start voting before extending the time." });
    }

    const votingRef = db.collection("settings").doc("voting");
    await votingRef.update({
      durationMinutes: FieldValue.increment(1),
      updatedAt: FieldValue.serverTimestamp(),
    });

    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to extend voting" });
  }
}

// Admin: closes the ballot to any new confirmations. Students already on the
// ballot screen still have VOTING_GRACE_MS (enforced in voteController.js)
// to submit.
export async function endVoting(req, res) {
  try {
    const votingRef = db.collection("settings").doc("voting");
    await votingRef.set(
      { status: "ended", endedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() },
      { merge: true }
    );
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to end voting" });
  }
}
