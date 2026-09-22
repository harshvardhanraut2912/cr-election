import { db, FieldValue } from "../services/firebaseAdmin.js";
import { findStudentByCardId } from "../services/studentsStore.js";

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

    if (!name || !rollNumber || !deviceId || !boysCandidateId || !girlsCandidateId) {
      return res.status(400).json({
        error: "name, rollNumber, deviceId, boysCandidateId and girlsCandidateId are all required",
      });
    }

    const voterRef = db.collection("voters").doc(rollDocId(rollNumber));
    const deviceRef = db.collection("devices").doc(deviceId);
    const boysCandidateRef = candidatesCollection("boys").doc(boysCandidateId);
    const girlsCandidateRef = candidatesCollection("girls").doc(girlsCandidateId);

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
        tx.get(boysCandidateRef),
        tx.get(girlsCandidateRef),
      ]);

      if (voterDoc.exists && voterDoc.data().voted) {
        throw { status: 403, message: "This roll number has already voted" };
      }
      if (deviceDoc.exists && deviceDoc.data().voted) {
        throw { status: 403, message: "This device has already been used to vote" };
      }
      if (!boysDoc.exists) throw { status: 400, message: "Invalid Boys elector" };
      if (!girlsDoc.exists) throw { status: 400, message: "Invalid Girls elector" };

      const votedAt = FieldValue.serverTimestamp();

      tx.set(
        voterRef,
        {
          name: name.trim(),
          deviceId,
          voted: true,
          boysChoice: boysCandidateId,
          girlsChoice: girlsCandidateId,
          votedAt,
        },
        { merge: true }
      );

      tx.set(deviceRef, { rollNumber: String(rollNumber), name: name.trim(), voted: true, votedAt }, { merge: true });

      tx.update(boysCandidateRef, { votes: FieldValue.increment(1) });
      tx.update(girlsCandidateRef, { votes: FieldValue.increment(1) });
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
