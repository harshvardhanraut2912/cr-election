import { db } from "./firebaseAdmin.js";

// How long, after voting closes (either the timer running out or admin
// clicking "End Voting"), students who are already on the ballot screen
// still have to submit. Keep in sync with the copy of this constant in
// client/src/hooks/useVotingWindow.js.
export const VOTING_GRACE_MS = 20000;
export const DEFAULT_DURATION_MINUTES = 10;

function toMillis(value) {
  if (!value) return null;
  if (typeof value.toMillis === "function") return value.toMillis();
  return null;
}

export async function getVotingDoc() {
  const snap = await db.collection("settings").doc("voting").get();
  return snap.exists ? snap.data() : null;
}

// Works out which phase the election is in from the raw settings/voting
// document. "live" = new votes may be started and submitted. "grace" = the
// window has just closed (naturally or via "End Voting") but students who
// were already mid-ballot get VOTING_GRACE_MS more to submit. "closed" =
// nobody can submit anymore. "idle" = voting was never started.
export function computeVotingPhase(voting, now = Date.now()) {
  if (!voting || voting.status === "idle" || !voting.startedAt) {
    return { phase: "idle" };
  }

  const startedAtMs = toMillis(voting.startedAt);
  const durationMinutes = voting.durationMinutes || DEFAULT_DURATION_MINUTES;
  const naturalCloseMs = startedAtMs + durationMinutes * 60000;
  const endedAtMs = toMillis(voting.endedAt);
  const closeMs = endedAtMs != null ? Math.min(endedAtMs, naturalCloseMs) : naturalCloseMs;
  const graceEndMs = closeMs + VOTING_GRACE_MS;

  if (voting.status === "live" && now < closeMs) {
    return { phase: "live", startedAtMs, durationMinutes, closeMs };
  }
  if (now < graceEndMs) {
    return { phase: "grace", closeMs, graceEndMs };
  }
  return { phase: "closed", closeMs, graceEndMs };
}
