import { useEffect, useState } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "../firebase/config.js";

// How long, after voting closes (either the timer running out or admin
// clicking "End Voting"), students who are already on the ballot screen
// still have to submit. Keep in sync with the copy of this constant in
// server/services/votingWindow.js.
export const VOTING_GRACE_MS = 20000;
const DEFAULT_DURATION_MINUTES = 10;

function toMillis(value) {
  if (!value) return null;
  if (typeof value.toMillis === "function") return value.toMillis();
  return null;
}

// Works out which phase the election is in from the raw settings/voting
// document. "idle" = never started. "live" = new votes may be started and
// submitted. "grace" = the window just closed (naturally or via "End
// Voting") but students already mid-ballot get VOTING_GRACE_MS more to
// submit. "closed" = nobody can submit anymore.
export function computeVotingPhase(voting, now) {
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
    return { phase: "live", startedAtMs, durationMinutes, closeMs, remainingMs: closeMs - now };
  }
  if (now < graceEndMs) {
    return { phase: "grace", closeMs, graceEndMs, remainingMs: graceEndMs - now };
  }
  return { phase: "closed", closeMs, graceEndMs, remainingMs: 0 };
}

// "9:42" style countdown for the live phase.
export function formatVotingClock(ms) {
  const totalSeconds = Math.max(0, Math.ceil((ms || 0) / 1000));
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

// Real-time voting-window state: subscribes to settings/voting (public read,
// same pattern as useDisplaySettings) and re-derives the phase every second
// on a local ticking clock so countdowns move without waiting for a write.
export function useVotingWindow() {
  const [voting, setVoting] = useState(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const ref = doc(db, "settings", "voting");
    const unsubscribe = onSnapshot(
      ref,
      (snap) => setVoting(snap.exists() ? snap.data() : null),
      () => setVoting(null)
    );
    return unsubscribe;
  }, []);

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  return computeVotingPhase(voting, now);
}
