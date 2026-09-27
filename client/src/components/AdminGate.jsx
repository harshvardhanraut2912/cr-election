import { useState } from "react";
import { useAdminGate } from "../hooks/useAdminGate.js";

const wrapStyle = {
  minHeight: "100vh",
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  padding: 24,
  gap: 12,
};
const inputStyle = { padding: "10px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "#fff", color: "var(--text)" };
const primaryButton = { padding: "10px 18px", borderRadius: 8, border: "none", background: "var(--primary)", color: "#fff", fontWeight: 600 };

// Gates admin/tv and admin/settings behind a token that is checked against
// ADMIN_TOKEN on the server (see /api/admin/verify). Children are only
// rendered — and therefore only mount their data hooks / start fetching
// anything — once that check has succeeded.
export default function AdminGate({ title, children }) {
  const { status, error, submitting, login } = useAdminGate();

  if (status === "authenticated") {
    return children;
  }

  return (
    <div style={wrapStyle}>
      <h2 style={{ margin: 0 }}>{title}</h2>
      {status === "checking" ? (
        <p style={{ color: "var(--text-muted)" }}>Checking admin access…</p>
      ) : (
        <>
          <p style={{ color: "var(--text-muted)", margin: 0 }}>Enter the admin token to continue.</p>
          <GateForm onSubmit={login} submitting={submitting} />
          {error && <p style={{ color: "var(--danger)", fontSize: 14, margin: 0 }}>{error}</p>}
        </>
      )}
    </div>
  );
}

function GateForm({ onSubmit, submitting }) {
  const [value, setValue] = useState("");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!submitting) onSubmit(value);
      }}
      style={{ display: "flex", gap: 8 }}
    >
      <input
        style={inputStyle}
        type="password"
        placeholder="Admin token"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        autoFocus
      />
      <button style={primaryButton} type="submit" disabled={submitting}>
        {submitting ? "Checking…" : "Enter"}
      </button>
    </form>
  );
}
