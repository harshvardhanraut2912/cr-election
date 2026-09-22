import { useEffect, useState } from "react";
import { getCandidates, adminAddCandidate, adminRemoveCandidate } from "../../services/api.js";

export default function AdminSettings() {
  const [token, setToken] = useState(localStorage.getItem("cr_election_admin_token") || "");
  const [candidates, setCandidates] = useState({ boys: [], girls: [] });
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const [category, setCategory] = useState("boys");
  const [name, setName] = useState("");

  function saveToken(t) {
    setToken(t);
    localStorage.setItem("cr_election_admin_token", t);
  }

  async function refresh() {
    setError("");
    try {
      const data = await getCandidates();
      setCandidates(data);
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => {
    if (token) refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  async function handleAdd(e) {
    e.preventDefault();
    if (!name.trim()) return;
    setError("");
    try {
      await adminAddCandidate(category, name.trim());
      setName("");
      setNotice("Elector added.");
      refresh();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleRemove(cat, id) {
    setError("");
    try {
      await adminRemoveCandidate(cat, id);
      setNotice("Elector removed.");
      refresh();
    } catch (err) {
      setError(err.message);
    }
  }

  if (!token) {
    return (
      <Centered>
        <h2>Admin Settings</h2>
        <p style={{ color: "var(--text-muted)" }}>Enter the admin token to continue.</p>
        <TokenForm onSubmit={saveToken} />
      </Centered>
    );
  }

  return (
    <div style={{ maxWidth: 720, margin: "0 auto", padding: 24 }}>
      <h1>Admin Settings</h1>
      {error && <Box color="var(--danger)" bg="var(--danger-bg)">{error}</Box>}
      {notice && <Box color="var(--success)" bg="var(--success-bg)">{notice}</Box>}

      <Section title="Add Elector">
        <form onSubmit={handleAdd} style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <select style={inputStyle} value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="boys">Boys CR</option>
            <option value="girls">Girls CR</option>
          </select>
          <input style={{ ...inputStyle, flex: 1, minWidth: 200 }} placeholder="Elector name" value={name} onChange={(e) => setName(e.target.value)} />
          <button style={primaryButton} type="submit">Add</button>
        </form>
      </Section>

      <Section title="Electors">
        <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
          <CandidateList title="Boys CR" category="boys" items={candidates.boys} onRemove={handleRemove} />
          <CandidateList title="Girls CR" category="girls" items={candidates.girls} onRemove={handleRemove} />
        </div>
      </Section>
    </div>
  );
}

function CandidateList({ title, category, items, onRemove }) {
  return (
    <div style={{ minWidth: 260, flex: 1 }}>
      <h4>{title}</h4>
      {items.map((c) => (
        <div key={c.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: "1px solid var(--border)" }}>
          <span>{c.name} <span style={{ color: "var(--text-muted)", fontSize: 13 }}>({c.votes || 0} votes)</span></span>
          <button style={dangerButton} onClick={() => onRemove(category, c.id)}>Remove</button>
        </div>
      ))}
      {items.length === 0 && <p style={{ color: "var(--text-muted)" }}>No electors yet.</p>}
    </div>
  );
}

function TokenForm({ onSubmit }) {
  const [value, setValue] = useState("");
  return (
    <form onSubmit={(e) => { e.preventDefault(); onSubmit(value); }} style={{ display: "flex", gap: 8 }}>
      <input style={inputStyle} type="password" placeholder="Admin token" value={value} onChange={(e) => setValue(e.target.value)} />
      <button style={primaryButton} type="submit">Enter</button>
    </form>
  );
}

function Section({ title, children }) {
  return (
    <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: 20, marginBottom: 20, boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
      <h3 style={{ marginTop: 0 }}>{title}</h3>
      {children}
    </div>
  );
}

function Box({ color, bg, children }) {
  return <div style={{ border: `1px solid ${color}`, background: bg, color, padding: 10, borderRadius: 8, marginBottom: 16, fontSize: 14 }}>{children}</div>;
}

function Centered({ children }) {
  return <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 24 }}>{children}</div>;
}

const inputStyle = { padding: "10px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "#fff", color: "var(--text)" };
const primaryButton = { padding: "10px 18px", borderRadius: 8, border: "none", background: "var(--primary)", color: "#fff", fontWeight: 600 };
const dangerButton = { padding: "6px 10px", borderRadius: 6, border: "1px solid #fecaca", background: "#fff", color: "var(--danger)", fontSize: 13 };
