import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_PATH = path.join(__dirname, "../data/students.json");

// Loaded once at server startup. Restart the server after editing students.json.
const students = JSON.parse(fs.readFileSync(DATA_PATH, "utf-8"));

const byMisId = new Map(
  students.map((s) => [String(s.mis_id).trim().toUpperCase(), s])
);

const byRollNumber = new Map(
  students.map((s) => [String(s.roll_no).trim(), s])
);

/**
 * Looks up a student by the ID barcoded on their identity card (e.g. "F260243").
 * Returns null if the card isn't in the roster.
 */
export function findStudentByCardId(misId) {
  if (!misId) return null;
  const key = String(misId).trim().toUpperCase();
  return byMisId.get(key) || null;
}

/**
 * Looks up a student by roll number (e.g. "10821") — used by the admin's
 * manual-vote tool for a student whose ID card couldn't be scanned.
 * Returns null if the roll number isn't in the roster.
 */
export function findStudentByRollNumber(rollNumber) {
  if (!rollNumber) return null;
  const key = String(rollNumber).trim();
  return byRollNumber.get(key) || null;
}

export function studentCount() {
  return students.length;
}
