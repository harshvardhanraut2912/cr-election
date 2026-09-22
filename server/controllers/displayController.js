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
