import { useEffect, useState } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "../../firebase/config.js";
import {
  getCandidates,
  adminAddCandidate,
  adminRemoveCandidate,
  adminClearSubmissionData,
  adminSetQrDisplay,
  adminStartVoting,
  adminExtendVoting,
  adminEndVoting,
  adminLookupStudentByRoll,
  adminCastManualVote,
} from "../../services/api.js";
import { useVotingWindow, formatVotingClock } from "../../hooks/useVotingWindow.js";

export default function AdminSettings() {
  const [token, setToken] = useState(localStorage.getItem("cr_election_admin_token") || "");
  const [candidates, setCandidates] = useState({ boys: [], girls: [] });
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [clearing, setClearing] = useState(false);
  const [showQr, setShowQr] = useState(false);
  const [qrSaving, setQrSaving] = useState(false);
  const [votingBusy, setVotingBusy] = useState(false);
  const voting = useVotingWindow();

  const [category, setCategory] = useState("boys");
  const [name, setName] = useState("");

  const [manualRoll, setManualRoll] = useState("");
  const [manualStudent, setManualStudent] = useState(null);
  const [manualSearching, setManualSearching] = useState(false);
  const [manualBoysChoice, setManualBoysChoice] = useState("");
  const [manualGirlsChoice, setManualGirlsChoice] = useState("");
  const [manualSubmitting, setManualSubmitting] = useState(false);

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

  useEffect(() => {
    const unsubscribe = onSnapshot(
      doc(db, "settings", "display"),
      (snap) => setShowQr(Boolean(snap.exists() && snap.data()?.showQr)),
      () => {}
    );
    return unsubscribe;
  }, []);

  async function handleAdd(e) {
    e.preventDefault();
    if (!name.trim()) return;
    setError("");
    setNotice("");
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
    setNotice("");
    try {
      await adminRemoveCandidate(cat, id);
      setNotice("Elector removed.");
      refresh();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleQrToggle(nextValue) {
    setError("");
    setNotice("");
    setShowQr(nextValue);
    setQrSaving(true);
    try {
      await adminSetQrDisplay(nextValue);
      setNotice(nextValue ? "QR display enabled on the TV." : "QR display hidden from the TV.");
    } catch (err) {
      setShowQr(!nextValue);
      setError(err.message);
    } finally {
      setQrSaving(false);
    }
  }

  async function handleManualSearch(e) {
    e.preventDefault();
    if (!manualRoll.trim()) return;
    setError("");
    setNotice("");
    setManualSearching(true);
    setManualStudent(null);
    setManualBoysChoice("");
    setManualGirlsChoice("");
    try {
      const student = await adminLookupStudentByRoll(manualRoll.trim());
      setManualStudent(student);
    } catch (err) {
      setError(err.message);
    } finally {
      setManualSearching(false);
    }
  }

  function handleManualReset() {
    setManualRoll("");
    setManualStudent(null);
    setManualBoysChoice("");
    setManualGirlsChoice("");
  }

  async function handleManualVote() {
    if (!manualStudent || !manualBoysChoice || !manualGirlsChoice) return;
    const confirmed = window.confirm(
      `Record a vote for ${manualStudent.name} (Roll ${manualStudent.rollNumber})?\n\nThis cannot be undone.`
    );
    if (!confirmed) return;

    setError("");
    setNotice("");
    setManualSubmitting(true);
    try {
      await adminCastManualVote({
        rollNumber: manualStudent.rollNumber,
        name: manualStudent.name,
        boysCandidateId: manualBoysChoice,
        girlsCandidateId: manualGirlsChoice,
      });
      setNotice(`Vote recorded manually for ${manualStudent.name}.`);
      handleManualReset();
      refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setManualSubmitting(false);
    }
  }

  async function handleStartVoting() {
    setError("");
    setNotice("");
    setVotingBusy(true);
    try {
      await adminStartVoting();
      setNotice("Voting is now live for 10 minutes. The QR overlay has been hidden on the TV.");
    } catch (err) {
      setError(err.message);
    } finally {
      setVotingBusy(false);
    }
  }

  async function handleExtendVoting() {
    setError("");
    setNotice("");
    setVotingBusy(true);
    try {
      await adminExtendVoting();
      setNotice("Added 1 minute to the voting window.");
    } catch (err) {
      setError(err.message);
    } finally {
      setVotingBusy(false);
    }
  }

  async function handleEndVoting() {
    const confirmed = window.confirm(
      "End voting now?\n\nNo new votes can be started after this. Students already on the ballot screen get 20 seconds to submit."
    );
    if (!confirmed) return;

    setError("");
    setNotice("");
    setVotingBusy(true);
    try {
      await adminEndVoting();
      setNotice("Voting has been ended. Students already on the ballot have 20 seconds left to submit.");
    } catch (err) {
      setError(err.message);
    } finally {
      setVotingBusy(false);
    }
  }

  async function handleClearSubmissionData() {
    const confirmed = window.confirm(
      "Clear ALL submitted vote data?\n\nThis will permanently remove every student's submitted-vote record and reset every elector's vote count to 0.\n\nThe elector names and student roster will NOT be deleted."
    );
    if (!confirmed) return;

    setError("");
    setNotice("");
    setClearing(true);

    try {
      const result = await adminClearSubmissionData();
      setNotice(
        `Election data cleared successfully. ${result.votersDeleted || 0} student submissions removed and ${result.electorsReset || 0} elector counts reset.`
      );
      await refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setClearing(false);
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

      <ManualVoteSection
        rollNumber={manualRoll}
        onRollChange={setManualRoll}
        onSearch={handleManualSearch}
        searching={manualSearching}
        student={manualStudent}
        onReset={handleManualReset}
        boysOptions={candidates.boys}
        girlsOptions={candidates.girls}
        boysChoice={manualBoysChoice}
        girlsChoice={manualGirlsChoice}
        onBoysChoice={setManualBoysChoice}
        onGirlsChoice={setManualGirlsChoice}
        onSubmit={handleManualVote}
        submitting={manualSubmitting}
      />

      <VotingSection
        voting={voting}
        busy={votingBusy}
        onStart={handleStartVoting}
        onExtend={handleExtendVoting}
        onEnd={handleEndVoting}
      />

      <QrSection
        enabled={showQr}
        saving={qrSaving}
        onToggle={handleQrToggle}
      />

      <DangerSection
        title="Clear Submission Data"
        onClear={handleClearSubmissionData}
        clearing={clearing}
      />
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

function ManualVoteSection({
  rollNumber,
  onRollChange,
  onSearch,
  searching,
  student,
  onReset,
  boysOptions,
  girlsOptions,
  boysChoice,
  girlsChoice,
  onBoysChoice,
  onGirlsChoice,
  onSubmit,
  submitting,
}) {
  return (
    <Section title="Manual Vote (+1)">
      <p style={{ marginTop: -6, marginBottom: 12, color: "var(--text-muted)", fontSize: 13.5, lineHeight: 1.5 }}>
        For a student whose ID card couldn't be scanned. Enter their roll number (e.g. <code>10821</code>) — not
        the student ID printed on the card — to look them up, then record their vote here.
      </p>

      <form onSubmit={onSearch} style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <input
          style={{ ...inputStyle, flex: 1, minWidth: 180 }}
          placeholder="Roll number, e.g. 10821"
          value={rollNumber}
          onChange={(e) => onRollChange(e.target.value)}
        />
        <button style={primaryButton} type="submit" disabled={searching || !rollNumber.trim()}>
          {searching ? "Searching…" : "Search"}
        </button>
      </form>

      {student && (
        <div style={{ marginTop: 16, padding: 16, border: "1px solid var(--border)", borderRadius: 12, background: "#fafbfd" }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: 16 }}>{student.name}</div>
              <div style={{ color: "var(--text-muted)", fontSize: 13, marginTop: 2 }}>
                Roll No. {student.rollNumber} · {student.division} · {student.misId}
              </div>
            </div>
            <button type="button" style={textLinkButton} onClick={onReset}>Clear</button>
          </div>

          <div style={{ display: "flex", gap: 10, marginTop: 14, flexWrap: "wrap" }}>
            <select style={{ ...inputStyle, flex: 1, minWidth: 180 }} value={boysChoice} onChange={(e) => onBoysChoice(e.target.value)}>
              <option value="">Select Boys' CR</option>
              {boysOptions.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            <select style={{ ...inputStyle, flex: 1, minWidth: 180 }} value={girlsChoice} onChange={(e) => onGirlsChoice(e.target.value)}>
              <option value="">Select Girls' CR</option>
              {girlsOptions.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>

          <button
            type="button"
            style={{
              ...primaryButton,
              width: "100%",
              marginTop: 12,
              opacity: !boysChoice || !girlsChoice || submitting ? 0.55 : 1,
              cursor: !boysChoice || !girlsChoice || submitting ? "not-allowed" : "pointer",
            }}
            onClick={onSubmit}
            disabled={!boysChoice || !girlsChoice || submitting}
          >
            {submitting ? "Recording…" : "Record Vote"}
          </button>
        </div>
      )}
    </Section>
  );
}

const VOTING_PHASE_COPY = {
  idle: { label: "NOT STARTED", color: "#64748b", bg: "#f1f5f9", border: "#e2e8f0" },
  live: { label: "LIVE", color: "#15803d", bg: "#f0fdf4", border: "#bbf7d0" },
  grace: { label: "CLOSING", color: "#c2410c", bg: "#fff7ed", border: "#fed7aa" },
  closed: { label: "ENDED", color: "#991b1b", bg: "#fef2f2", border: "#fecaca" },
};

function VotingSection({ voting, busy, onStart, onExtend, onEnd }) {
  const phase = voting.phase;
  const tone = VOTING_PHASE_COPY[phase] || VOTING_PHASE_COPY.idle;

  let clockText = "—:—";
  if (phase === "live") clockText = formatVotingClock(voting.remainingMs);
  else if (phase === "grace") clockText = `${Math.ceil((voting.remainingMs || 0) / 1000)}s`;
  else if (phase === "closed") clockText = "Closed";

  return (
    <div style={{
      background: "linear-gradient(135deg, #fbfaff, #f5faff)",
      border: "1px solid #e3e0fb",
      borderRadius: 16,
      padding: 20,
      marginBottom: 20,
      boxShadow: "0 8px 24px rgba(79, 70, 229, 0.06)",
    }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 240 }}>
          <h3 style={{ margin: 0 }}>Voting Window</h3>
          <p style={{ margin: "5px 0 0", color: "var(--text-muted)", lineHeight: 1.45, fontSize: 14 }}>
            Starting voting unlocks "Confirm &amp; Continue" on every student device instantly and force-closes the TV's QR overlay.
          </p>
        </div>
        <span style={{
          padding: "6px 12px", borderRadius: 999, fontSize: 11, fontWeight: 900, letterSpacing: 1,
          color: tone.color, background: tone.bg, border: `1px solid ${tone.border}`,
        }}>{tone.label}</span>
      </div>

      <div style={{ marginTop: 16, fontSize: phase === "grace" ? 34 : 30, fontWeight: 900, letterSpacing: -1, color: tone.color }}>
        {clockText}
        {phase === "live" && <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text-muted)", marginLeft: 10 }}>remaining</span>}
        {phase === "grace" && <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text-muted)", marginLeft: 10 }}>grace period left</span>}
      </div>

      <div style={{ display: "flex", gap: 10, marginTop: 16, flexWrap: "wrap" }}>
        <button type="button" style={primaryButton} onClick={onStart} disabled={busy || phase === "live"}>
          {phase === "live" ? "Voting Live" : "Start Voting"}
        </button>
        <button
          type="button"
          style={{ ...inputStyle, fontWeight: 700, cursor: busy || phase !== "live" ? "not-allowed" : "pointer", opacity: busy || phase !== "live" ? 0.55 : 1 }}
          onClick={onExtend}
          disabled={busy || phase !== "live"}
        >
          +1 Minute
        </button>
        <button
          type="button"
          style={{ ...dangerButton, padding: "10px 16px", fontWeight: 700, opacity: busy || (phase !== "live" && phase !== "grace") ? 0.55 : 1, cursor: busy || (phase !== "live" && phase !== "grace") ? "not-allowed" : "pointer" }}
          onClick={onEnd}
          disabled={busy || (phase !== "live" && phase !== "grace")}
        >
          End Voting
        </button>
      </div>
    </div>
  );
}

function QrSection({ enabled, saving, onToggle }) {
  return (
    <div style={{
      background: "linear-gradient(135deg, #f8fbff, #f8f5ff)",
      border: "1px solid #dbe4f2",
      borderRadius: 16,
      padding: 20,
      marginBottom: 20,
      boxShadow: "0 8px 24px rgba(37, 99, 235, 0.06)",
    }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 20, flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 240 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{
              width: 40, height: 40, borderRadius: 12, display: "grid", placeItems: "center",
              background: "linear-gradient(135deg,#2563eb,#7c3aed)", color: "#fff", fontWeight: 900, fontSize: 16
            }}>QR</span>
            <div>
              <h3 style={{ margin: 0 }}>Show QR on TV</h3>
              <p style={{ margin: "5px 0 0", color: "var(--text-muted)", lineHeight: 1.45, fontSize: 14 }}>
                Display the student voting QR code as a full-screen overlay on <strong>/admin/tv</strong>.
              </p>
            </div>
          </div>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-label="Toggle QR display on TV"
          disabled={saving}
          onClick={() => onToggle(!enabled)}
          style={{
            width: 68, height: 38, padding: 3, borderRadius: 999, border: "none",
            background: enabled ? "linear-gradient(135deg,#2563eb,#7c3aed)" : "#d5dae3",
            boxShadow: enabled ? "0 8px 20px rgba(79,70,229,.25)" : "inset 0 1px 2px rgba(0,0,0,.08)",
            cursor: saving ? "wait" : "pointer", transition: "all .2s ease",
            opacity: saving ? .65 : 1, position: "relative"
          }}
        >
          <span style={{
            display: "block", width: 32, height: 32, borderRadius: "50%", background: "#fff",
            transform: enabled ? "translateX(30px)" : "translateX(0)", transition: "transform .22s cubic-bezier(.2,.8,.2,1)",
            boxShadow: "0 2px 7px rgba(15,23,42,.2)"
          }} />
        </button>
      </div>
      <div style={{ marginTop: 14, fontSize: 12, fontWeight: 800, color: enabled ? "#4338ca" : "#7b8494" }}>
        {saving ? "Updating TV…" : enabled ? "ON · QR is visible on the TV now" : "OFF · TV leaderboard is visible"}
      </div>
    </div>
  );
}

function DangerSection({ title, onClear, clearing }) {
  return (
    <div style={{
      background: "#fff",
      border: "1px solid #fecaca",
      borderRadius: 12,
      padding: 20,
      marginBottom: 20,
      boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
    }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 20, flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 240 }}>
          <h3 style={{ marginTop: 0, marginBottom: 8, color: "#991b1b" }}>{title}</h3>
          <p style={{ margin: 0, color: "var(--text-muted)", lineHeight: 1.5, fontSize: 14 }}>
            Permanently remove all submitted student vote records and reset every elector's vote count to <strong>0</strong>. Elector names and the student roster stay untouched.
          </p>
        </div>
        <button
          type="button"
          onClick={onClear}
          disabled={clearing}
          style={{
            ...dangerButton,
            padding: "11px 16px",
            fontWeight: 700,
            opacity: clearing ? 0.6 : 1,
            cursor: clearing ? "not-allowed" : "pointer",
            whiteSpace: "nowrap",
          }}
        >
          {clearing ? "Clearing…" : "Clear All Submissions"}
        </button>
      </div>
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
const textLinkButton = { border: "none", background: "transparent", color: "var(--primary)", fontWeight: 600, fontSize: 13, padding: 0, cursor: "pointer" };
