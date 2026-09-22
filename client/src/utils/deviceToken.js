// Generates (or retrieves) a persistent, unique device token stored in this
// browser's localStorage. This — NOT the human-readable device name — is the
// real identifier used by the backend to enforce "one device = one roll number".
const STORAGE_KEY = "cr_election_device_token";

function generateToken() {
  if (window.crypto && window.crypto.randomUUID) {
    return window.crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export function getDeviceToken() {
  let token = localStorage.getItem(STORAGE_KEY);
  if (!token) {
    token = generateToken();
    localStorage.setItem(STORAGE_KEY, token);
  }
  return token;
}
