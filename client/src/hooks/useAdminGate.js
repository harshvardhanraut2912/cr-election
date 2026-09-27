import { useCallback, useEffect, useState } from "react";
import { adminVerifyToken } from "../services/api.js";

const STORAGE_KEY = "cr_election_admin_token";

// Shared by /admin/tv and /admin/settings. Status starts at "checking" (never
// "authenticated") so callers can't render page content or mount data hooks
// until the token has actually been confirmed against the server's
// ADMIN_TOKEN — a token merely being present in localStorage is never enough.
export function useAdminGate() {
  const [status, setStatus] = useState("checking"); // checking | unauthenticated | authenticated
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const stored = localStorage.getItem(STORAGE_KEY);

    if (!stored) {
      setStatus("unauthenticated");
      return;
    }

    adminVerifyToken(stored)
      .then(() => {
        if (!cancelled) setStatus("authenticated");
      })
      .catch(() => {
        if (cancelled) return;
        localStorage.removeItem(STORAGE_KEY);
        setStatus("unauthenticated");
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async (token) => {
    setError("");
    setSubmitting(true);
    try {
      await adminVerifyToken(token);
      localStorage.setItem(STORAGE_KEY, token);
      setStatus("authenticated");
    } catch (err) {
      localStorage.removeItem(STORAGE_KEY);
      setError("Incorrect admin token.");
    } finally {
      setSubmitting(false);
    }
  }, []);

  return { status, error, submitting, login };
}
