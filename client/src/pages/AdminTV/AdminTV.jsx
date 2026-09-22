import { useLiveCandidates } from "../../hooks/useLiveCandidates.js";

export default function AdminTV() {
  const { boys, girls } = useLiveCandidates();

  return (
    <div style={{ minHeight: "100vh", padding: 32 }}>
      <div style={{ textAlign: "center", marginBottom: 32 }}>
        <h1 style={{ fontSize: 36, margin: 0 }}>Class Representative Election</h1>
        <div style={{ fontSize: 16, color: "var(--text-muted)", marginTop: 6 }}>Live results</div>
      </div>

      <div style={{ display: "flex", gap: 24, justifyContent: "center", flexWrap: "wrap" }}>
        <LeaderboardTable title="Boys CR" rows={boys} />
        <LeaderboardTable title="Girls CR" rows={girls} />
      </div>
    </div>
  );
}

function LeaderboardTable({ title, rows }) {
  const sorted = [...rows].sort((a, b) => (b.votes || 0) - (a.votes || 0));
  const maxVotes = Math.max(1, ...sorted.map((r) => r.votes || 0));

  return (
    <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 14, padding: 24, minWidth: 380, boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
      <h2 style={{ marginTop: 0, marginBottom: 16 }}>{title}</h2>
      {sorted.length === 0 && <p style={{ color: "var(--text-muted)" }}>No electors added yet.</p>}
      {sorted.map((c) => (
        <div key={c.id} style={{ marginBottom: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4, fontSize: 16 }}>
            <span>{c.name}</span>
            <strong>{c.votes || 0}</strong>
          </div>
          <div style={{ background: "#eef1f5", borderRadius: 6, height: 10, overflow: "hidden" }}>
            <div
              style={{
                width: `${((c.votes || 0) / maxVotes) * 100}%`,
                background: "var(--primary)",
                height: "100%",
                transition: "width 0.4s ease",
              }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
