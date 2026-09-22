// In production (Vercel) the API is served from the same origin under /api,
// so no base URL is needed — that's what makes this work with zero config
// after deploy. Locally, vite.config.js proxies /api to the Express dev
// server, so the same relative default works there too. VITE_API_BASE_URL
// is only needed if you ever host the API on a different origin.
const BASE_URL = import.meta.env.VITE_API_BASE_URL || "/api";

async function request(path, options = {}) {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `Request failed (${res.status})`);
  }
  return data;
}

// ---- Public / student ----
export const getCandidates = () => request(`/candidates`);

// Resolves the barcode scanned off a student's identity card (e.g. "F260243")
// to their roll number + name from the server-side roster.
export const lookupStudentByCard = (misId) =>
  request(`/vote/lookup`, { method: "POST", body: JSON.stringify({ misId }) });

export const validateVoter = ({ name, rollNumber, deviceId }) =>
  request(`/vote/validate`, { method: "POST", body: JSON.stringify({ name, rollNumber, deviceId }) });

export const castVote = ({ name, rollNumber, deviceId, boysCandidateId, girlsCandidateId }) =>
  request(`/vote/cast`, {
    method: "POST",
    body: JSON.stringify({ name, rollNumber, deviceId, boysCandidateId, girlsCandidateId }),
  });

// ---- Admin ----
function adminHeaders() {
  const token = localStorage.getItem("cr_election_admin_token") || import.meta.env.VITE_ADMIN_TOKEN;
  return { Authorization: `Bearer ${token}` };
}

export const adminAddCandidate = (category, name) =>
  request(`/admin/candidates`, { method: "POST", headers: adminHeaders(), body: JSON.stringify({ category, name }) });

export const adminEditCandidate = (category, candidateId, name) =>
  request(`/admin/candidates/${category}/${candidateId}`, {
    method: "PUT",
    headers: adminHeaders(),
    body: JSON.stringify({ name }),
  });

export const adminRemoveCandidate = (category, candidateId) =>
  request(`/admin/candidates/${category}/${candidateId}`, { method: "DELETE", headers: adminHeaders() });

export const adminClearSubmissionData = () =>
  request(`/admin/submissions`, { method: "DELETE", headers: adminHeaders() });
