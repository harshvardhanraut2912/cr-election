import { db } from "../services/firebaseAdmin.js";

function candidatesCollection(category) {
  const sub = category === "boys" ? "candidates_boys" : "candidates_girls";
  return db.collection(sub);
}

// Public: candidate lists with live vote counts (used by both the vote page and the TV)
export async function getCandidates(req, res) {
  try {
    const [boysSnap, girlsSnap] = await Promise.all([
      candidatesCollection("boys").orderBy("order", "asc").get(),
      candidatesCollection("girls").orderBy("order", "asc").get(),
    ]);
    res.json({
      boys: boysSnap.docs.map((d) => ({ id: d.id, name: d.data().name, votes: d.data().votes || 0 })),
      girls: girlsSnap.docs.map((d) => ({ id: d.id, name: d.data().name, votes: d.data().votes || 0 })),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load candidates" });
  }
}

// Admin: add an elector/candidate
export async function addCandidate(req, res) {
  try {
    const { category, name } = req.body;
    if (!["boys", "girls"].includes(category) || !name || !name.trim()) {
      return res.status(400).json({ error: "category (boys/girls) and name are required" });
    }
    const coll = candidatesCollection(category);
    const countSnap = await coll.get();
    const docRef = await coll.add({ name: name.trim(), votes: 0, order: countSnap.size });
    res.status(201).json({ ok: true, id: docRef.id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to add elector" });
  }
}

// Admin: edit an elector's name
export async function editCandidate(req, res) {
  try {
    const { category, candidateId } = req.params;
    const { name } = req.body;
    if (!["boys", "girls"].includes(category) || !name || !name.trim()) {
      return res.status(400).json({ error: "Valid category and name are required" });
    }
    await candidatesCollection(category).doc(candidateId).update({ name: name.trim() });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to edit elector" });
  }
}

// Admin: remove an elector
export async function removeCandidate(req, res) {
  try {
    const { category, candidateId } = req.params;
    if (!["boys", "girls"].includes(category)) return res.status(400).json({ error: "Invalid category" });
    await candidatesCollection(category).doc(candidateId).delete();
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to remove elector" });
  }
}
