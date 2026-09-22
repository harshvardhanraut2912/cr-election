import admin from "firebase-admin";
import fs from "fs";
import dotenv from "dotenv";
dotenv.config();

let credential;

// Env vars checked first so this works unmodified on Vercel (no filesystem secret
// file is deployed there — serviceAccountKey.json stays local/.gitignored).
// Falls back to the local service-account file for local dev if you prefer that.
if (process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY) {
  credential = admin.credential.cert({
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
  });
} else if (process.env.FIREBASE_SERVICE_ACCOUNT_PATH && fs.existsSync(process.env.FIREBASE_SERVICE_ACCOUNT_PATH)) {
  const serviceAccount = JSON.parse(
    fs.readFileSync(process.env.FIREBASE_SERVICE_ACCOUNT_PATH, "utf8")
  );
  credential = admin.credential.cert(serviceAccount);
} else {
  throw new Error(
    "No Firebase Admin credentials found. Set FIREBASE_PROJECT_ID/FIREBASE_CLIENT_EMAIL/FIREBASE_PRIVATE_KEY (required on Vercel) or FIREBASE_SERVICE_ACCOUNT_PATH in server/.env for local dev"
  );
}

if (!admin.apps.length) {
  admin.initializeApp({ credential });
}

export const db = admin.firestore();
export const FieldValue = admin.firestore.FieldValue;
export default admin;
