import { db, FieldValue } from "../services/firebaseAdmin.js";
import { findStudentByCardId, findStudentByRollNumber } from "../services/studentsStore.js";
import { getVotingDoc, computeVotingPhase, DEFAULT_DURATION_MINUTES } from "../services/votingWindow.js";

function rollDocId(rollNumber) {
  return `roll_${String(rollNumber).trim()}`;
}

function candidatesCollection(category) {
  const sub = category === "boys" ? "candidates_boys" : "candidates_girls";
  return db.collection(sub);
}

// Scans the barcode on the student's identity card (just the MIS ID, e.g. "F260243")
// and resolves it to a roll number + name from the server-side roster.
// This is the new entry point that replaces manual name/roll typing.
export async function lookupStudent(req, res) {
  try {
    const { misId } = req.body;
    if (!misId || !String(misId).trim()) {
      return res.status(400).json({ error: "Scan your identity card to continue" });
    }

    const student = findStudentByCardId(misId);
    if (!student) {
      return res.status(404).json({ error: "Card not recognized. Please try again or contact the election desk." });
    }

    res.json({
      ok: true,
      rollNumber: student.roll_no,
      name: student.student_name,
      division: student.division,
      misId: student.mis_id,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Lookup failed" });
  }
}

// Checks roll number + device + name before letting the student see the ballot.
// Does not mark anything as voted yet — just confirms none of the three have voted before.
export async function validateVoter(req, res) {
  try {
    const { name, rollNumber, deviceId } = req.body;
    if (!name || !name.trim() || !rollNumber || !String(rollNumber).trim() || !deviceId) {
      return res.status(400).json({ error: "Name, roll number and device are required" });
    }

    // New confirmations are only allowed while voting is actually live — this
    // is what keeps "Confirm & Continue" locked before the admin starts
    // voting, and locked again the instant "End Voting" is clicked. Students
    // who already made it past this check keep going through castVote below,
    // which allows a short grace window.
    const votingPhase = computeVotingPhase(await getVotingDoc()).phase;
    if (votingPhase !== "live") {
      const message =
        votingPhase === "idle"
          ? "Voting hasn't started yet. Please wait for the election desk to begin voting."
          : "Voting has ended. New votes can no longer be started.";
      return res.status(403).json({ error: message, votingPhase });
    }

    const voterRef = db.collection("voters").doc(rollDocId(rollNumber));
    const deviceRef = db.collection("devices").doc(deviceId);

    const [voterDoc, deviceDoc, nameMatchSnap] = await Promise.all([
      voterRef.get(),
      deviceRef.get(),
      db.collection("voters").where("name", "==", name.trim()).where("voted", "==", true).limit(1).get(),
    ]);

    if (voterDoc.exists && voterDoc.data().voted) {
      return res.status(403).json({ error: "This roll number has already voted" });
    }
    if (deviceDoc.exists && deviceDoc.data().voted) {
      return res.status(403).json({ error: "This device has already been used to vote" });
    }
    if (!nameMatchSnap.empty) {
      return res.status(403).json({ error: "A vote has already been submitted under this name" });
    }

    // Record/refresh the device -> roll number association (not yet voted)
    await deviceRef.set(
      {
        rollNumber: String(rollNumber),
        name: name.trim(),
        voted: deviceDoc.exists ? deviceDoc.data().voted : false,
        lastSeenAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    res.json({ ok: true, rollNumber: String(rollNumber) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Validation failed" });
  }
}

// Casts the vote. Fully re-validates everything server-side inside a transaction.
export async function castVote(req, res) {
  try {
    const { name, rollNumber, deviceId, boysCandidateId, girlsCandidateId } = req.body;

    if (!name || !rollNumber || !deviceId) {
      return res.status(400).json({ error: "name, rollNumber and deviceId are required" });
    }

    // Admin-controlled toggle (settings/display.flexibleVoting): when off
    // (the default), a student must pick exactly one Boys CR and one Girls
    // CR — the original behavior. When on, a student may submit a Boys-only
    // vote, a Girls-only vote, or both, as long as at least one is chosen.
    const displaySettingsSnap = await db.collection("settings").doc("display").get();
    const flexibleVoting = Boolean(displaySettingsSnap.exists && displaySettingsSnap.data()?.flexibleVoting);

    if (flexibleVoting) {
      if (!boysCandidateId && !girlsCandidateId) {
        return res.status(400).json({ error: "Select at least one candidate to vote for." });
      }
    } else if (!boysCandidateId || !girlsCandidateId) {
      return res.status(400).json({
        error: "boysCandidateId and girlsCandidateId are both required",
      });
    }

    // Students already on the ballot get the grace window too (not just
    // "live") — this is the 20-second buffer after voting closes.
    const votingPhase = computeVotingPhase(await getVotingDoc()).phase;
    if (votingPhase !== "live" && votingPhase !== "grace") {
      return res.status(403).json({ error: "Voting has closed. Your vote could not be recorded.", votingPhase });
    }

    const voterRef = db.collection("voters").doc(rollDocId(rollNumber));
    const deviceRef = db.collection("devices").doc(deviceId);
    const boysCandidateRef = boysCandidateId ? candidatesCollection("boys").doc(boysCandidateId) : null;
    const girlsCandidateRef = girlsCandidateId ? candidatesCollection("girls").doc(girlsCandidateId) : null;

    // Name-uniqueness check happens outside the transaction (Firestore transactions
    // can't mix a query read with document reads/writes cleanly here); re-checked
    // right before committing, so a same-millisecond double submit is still caught
    // by the roll number / device checks inside the transaction below.
    const nameMatchSnap = await db
      .collection("voters")
      .where("name", "==", name.trim())
      .where("voted", "==", true)
      .limit(1)
      .get();
    if (!nameMatchSnap.empty) {
      return res.status(403).json({ error: "A vote has already been submitted under this name" });
    }

    await db.runTransaction(async (tx) => {
      const [voterDoc, deviceDoc, boysDoc, girlsDoc] = await Promise.all([
        tx.get(voterRef),
        tx.get(deviceRef),
        boysCandidateRef ? tx.get(boysCandidateRef) : Promise.resolve(null),
        girlsCandidateRef ? tx.get(girlsCandidateRef) : Promise.resolve(null),
      ]);

      if (voterDoc.exists && voterDoc.data().voted) {
        throw { status: 403, message: "This roll number has already voted" };
      }
      if (deviceDoc.exists && deviceDoc.data().voted) {
        throw { status: 403, message: "This device has already been used to vote" };
      }
      if (boysCandidateRef && !boysDoc.exists) throw { status: 400, message: "Invalid Boys elector" };
      if (girlsCandidateRef && !girlsDoc.exists) throw { status: 400, message: "Invalid Girls elector" };

      const votedAt = FieldValue.serverTimestamp();

      tx.set(
        voterRef,
        {
          name: name.trim(),
          deviceId,
          voted: true,
          boysChoice: boysCandidateId || null,
          girlsChoice: girlsCandidateId || null,
          votedAt,
        },
        { merge: true }
      );

      tx.set(deviceRef, { rollNumber: String(rollNumber), name: name.trim(), voted: true, votedAt }, { merge: true });

      if (boysCandidateRef) tx.update(boysCandidateRef, { votes: FieldValue.increment(1) });
      if (girlsCandidateRef) tx.update(girlsCandidateRef, { votes: FieldValue.increment(1) });
    });

    res.json({ ok: true, message: "Vote submitted successfully" });
  } catch (err) {
    if (err && err.status) {
      return res.status(err.status).json({ error: err.message });
    }
    console.error(err);
    res.status(500).json({ error: "Failed to submit vote" });
  }
}

// Admin: looks up a student by roll number (e.g. "10821") for the manual-vote
// tool on the settings page — for a student whose ID card couldn't be scanned.
export async function adminLookupStudent(req, res) {
  try {
    const { rollNumber } = req.body;
    if (!rollNumber || !String(rollNumber).trim()) {
      return res.status(400).json({ error: "Enter a roll number to search" });
    }

    const student = findStudentByRollNumber(rollNumber);
    if (!student) {
      return res.status(404).json({ error: "No student found with that roll number" });
    }

    res.json({
      ok: true,
      rollNumber: student.roll_no,
      name: student.student_name,
      division: student.division,
      misId: student.mis_id,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Lookup failed" });
  }
}

// Admin: records a vote on behalf of a student found via adminLookupStudent
// above (roll-number search instead of a card scan). Enforces the same
// one-vote-per-roll-number / one-vote-per-name guarantees as the student flow,
// but intentionally skips the live-voting-window gate and the device check —
// this is an admin override for a student who couldn't use their own device.
export async function adminCastVote(req, res) {
  try {
    const { rollNumber, name, boysCandidateId, girlsCandidateId } = req.body;
    if (!rollNumber || !name || !boysCandidateId || !girlsCandidateId) {
      return res.status(400).json({
        error: "rollNumber, name, boysCandidateId and girlsCandidateId are all required",
      });
    }

    const voterRef = db.collection("voters").doc(rollDocId(rollNumber));
    const boysCandidateRef = candidatesCollection("boys").doc(boysCandidateId);
    const girlsCandidateRef = candidatesCollection("girls").doc(girlsCandidateId);

    const nameMatchSnap = await db
      .collection("voters")
      .where("name", "==", name.trim())
      .where("voted", "==", true)
      .limit(1)
      .get();
    if (!nameMatchSnap.empty) {
      return res.status(403).json({ error: "A vote has already been submitted under this name" });
    }

    await db.runTransaction(async (tx) => {
      const [voterDoc, boysDoc, girlsDoc] = await Promise.all([
        tx.get(voterRef),
        tx.get(boysCandidateRef),
        tx.get(girlsCandidateRef),
      ]);

      if (voterDoc.exists && voterDoc.data().voted) {
        throw { status: 403, message: "This roll number has already voted" };
      }
      if (!boysDoc.exists) throw { status: 400, message: "Invalid Boys elector" };
      if (!girlsDoc.exists) throw { status: 400, message: "Invalid Girls elector" };

      const votedAt = FieldValue.serverTimestamp();

      tx.set(
        voterRef,
        {
          name: name.trim(),
          deviceId: "admin-manual",
          voted: true,
          boysChoice: boysCandidateId,
          girlsChoice: girlsCandidateId,
          votedAt,
          castBy: "admin",
        },
        { merge: true }
      );

      tx.update(boysCandidateRef, { votes: FieldValue.increment(1) });
      tx.update(girlsCandidateRef, { votes: FieldValue.increment(1) });
    });

    res.json({ ok: true, message: "Vote recorded manually" });
  } catch (err) {
    if (err && err.status) {
      return res.status(err.status).json({ error: err.message });
    }
    console.error(err);
    res.status(500).json({ error: "Failed to record vote" });
  }
}

// Admin: "+1" on a single elector, for a student whose ID (e.g. "F260243")
// is NOT in students.json (NRI ID cards etc.), so we have no roll number or
// name for them. The admin types the ID, and this counts one normal vote for
// that elector. The ID is stored as an "incomplete data" voter record so the
// same ID can't be counted twice for the same category (Boys / Girls). One ID
// may still give one Boys vote and one Girls vote, via two separate +1 clicks.
export async function adminPlusOneVote(req, res) {
  try {
    const { category, candidateId, misId } = req.body;

    if (category !== "boys" && category !== "girls") {
      return res.status(400).json({ error: "Invalid category" });
    }
    if (!candidateId) {
      return res.status(400).json({ error: "candidateId is required" });
    }

    const cleanId = String(misId || "").trim().toUpperCase();
    if (!/^F26\d+$/.test(cleanId)) {
      return res.status(400).json({ error: "Enter a valid ID like F260243" });
    }

    // IDs that exist in the roster must go through the normal scan / manual-vote
    // flow, otherwise the same student could be counted twice under two records.
    if (findStudentByCardId(cleanId)) {
      return res.status(409).json({
        error: "This ID is in the student list. Use the normal scan or the Manual Vote tool for this student.",
      });
    }

    const voterRef = db.collection("voters").doc(`nri_${cleanId}`);
    const candidateRef = candidatesCollection(category).doc(candidateId);
    const choiceField = category === "boys" ? "boysChoice" : "girlsChoice";

    await db.runTransaction(async (tx) => {
      const [voterDoc, candidateDoc] = await Promise.all([tx.get(voterRef), tx.get(candidateRef)]);

      if (!candidateDoc.exists) throw { status: 400, message: "Invalid elector" };

      if (voterDoc.exists && voterDoc.data()[choiceField]) {
        throw {
          status: 403,
          message: `A ${category === "boys" ? "Boys" : "Girls"} CR vote has already been counted for ${cleanId}`,
        };
      }

      tx.set(
        voterRef,
        {
          name: `Manual entry (${cleanId})`,
          misId: cleanId,
          deviceId: "admin-plus-one",
          voted: true,
          [choiceField]: candidateId,
          votedAt: FieldValue.serverTimestamp(),
          castBy: "admin-plus-one",
          incompleteData: true,
        },
        { merge: true }
      );

      tx.update(candidateRef, { votes: FieldValue.increment(1) });
    });

    res.json({ ok: true, message: `+1 vote recorded for ${cleanId}` });
  } catch (err) {
    if (err && err.status) {
      return res.status(err.status).json({ error: err.message });
    }
    console.error(err);
    res.status(500).json({ error: "Failed to record +1 vote" });
  }
}

// Admin: completely reset the submitted-vote state without deleting the elector roster.
// This removes all voter/device submission records and resets every elector's vote count to 0.
export async function clearSubmissionData(req, res) {
  try {
    async function deleteCollection(collectionName) {
      let deleted = 0;
      while (true) {
        const snap = await db.collection(collectionName).limit(450).get();
        if (snap.empty) break;

        const batch = db.batch();
        snap.docs.forEach((doc) => batch.delete(doc.ref));
        await batch.commit();
        deleted += snap.size;

        if (snap.size < 450) break;
      }
      return deleted;
    }

    // Reset the voting window itself back to idle, so "Clear All Submissions"
    // also wipes the open/closed (live/ended) state left over from a previous
    // election run — otherwise the TV and student app keep treating voting as
    // already started/ended even though every vote record was just deleted.
    const votingRef = db.collection("settings").doc("voting");
    const resetVotingWindow = votingRef.set(
      {
        status: "idle",
        startedAt: null,
        endedAt: null,
        durationMinutes: DEFAULT_DURATION_MINUTES,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: false }
    );

    const [votersDeleted, devicesDeleted, boysSnap, girlsSnap] = await Promise.all([
      deleteCollection("voters"),
      deleteCollection("devices"),
      db.collection("candidates_boys").get(),
      db.collection("candidates_girls").get(),
      resetVotingWindow,
    ]);

    const resetVotes = async (snap) => {
      let updated = 0;
      for (let i = 0; i < snap.docs.length; i += 450) {
        const batch = db.batch();
        snap.docs.slice(i, i + 450).forEach((doc) => {
          batch.update(doc.ref, { votes: 0 });
        });
        await batch.commit();
        updated += Math.min(450, snap.docs.length - i);
      }
      return updated;
    };

    const [boysReset, girlsReset] = await Promise.all([
      resetVotes(boysSnap),
      resetVotes(girlsSnap),
    ]);

    res.json({
      ok: true,
      message: "All vote submission data has been cleared",
      votersDeleted,
      devicesDeleted,
      electorsReset: boysReset + girlsReset,
    });
  } catch (err) {
    console.error("Failed to clear submission data:", err);
    res.status(500).json({ error: "Failed to clear submission data" });
  }
}

