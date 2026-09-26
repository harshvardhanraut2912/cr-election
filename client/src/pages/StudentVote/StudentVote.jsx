import { useMemo, useState } from "react";
import { getDeviceToken } from "../../utils/deviceToken.js";
import { lookupStudentByCard, validateVoter, getCandidates, castVote } from "../../services/api.js";
import { useVotingWindow, formatVotingClock } from "../../hooks/useVotingWindow.js";
import CameraScanner from "./CameraScanner.jsx";

const STAGES = {
  SCAN: "SCAN",
  VERIFY: "VERIFY",
  ALREADY_VOTED: "ALREADY_VOTED",
  VOTING: "VOTING",
  CONFIRM: "CONFIRM",
  DONE: "DONE",
};

export default function StudentVote() {
  const [stage, setStage] = useState(STAGES.SCAN);
  const [student, setStudent] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [submitPulse, setSubmitPulse] = useState(false);

  const [candidates, setCandidates] = useState({ boys: [], girls: [] });
  const [boysChoice, setBoysChoice] = useState(null);
  const [girlsChoice, setGirlsChoice] = useState(null);

  const deviceId = useMemo(() => getDeviceToken(), []);
  const voting = useVotingWindow();

  async function handleCardScanned(rawValue) {
    const misId = String(rawValue || "").trim().toUpperCase();
    if (!misId || scanning) return;

    setError("");
    setScanning(true);
    try {
      const found = await lookupStudentByCard(misId);
      setStudent(found);
      setStage(STAGES.VERIFY);
    } catch (err) {
      setError(err?.message || "Card could not be recognized. Please try again.");
      setStage(STAGES.SCAN);
    } finally {
      setScanning(false);
    }
  }

  async function handleConfirmStudent() {
    if (!student) return;
    setLoading(true);
    setError("");
    try {
      await validateVoter({ name: student.name, rollNumber: student.rollNumber, deviceId });
      const data = await getCandidates();
      setCandidates({
        boys: Array.isArray(data?.boys) ? data.boys : [],
        girls: Array.isArray(data?.girls) ? data.girls : [],
      });
      setBoysChoice(null);
      setGirlsChoice(null);
      setStage(STAGES.VOTING);
    } catch (err) {
      const message = err?.message || "Unable to verify this student.";
      setError(message);
      if (/already voted|already been used|already been submitted/i.test(message)) {
        setStage(STAGES.ALREADY_VOTED);
      } else {
        setStage(STAGES.VERIFY);
      }
    } finally {
      setLoading(false);
    }
  }

  function handleScanAnother() {
    setStudent(null);
    setError("");
    setBoysChoice(null);
    setGirlsChoice(null);
    setStage(STAGES.SCAN);
  }

  function handleGoToConfirm() {
    if (!boysChoice || !girlsChoice) {
      setError("Please select one Boys CR and one Girls CR candidate.");
      return;
    }
    setError("");
    setStage(STAGES.CONFIRM);
  }

  async function handleSubmit() {
    if (!student || !boysChoice || !girlsChoice || loading) return;
    setLoading(true);
    setError("");
    setSubmitPulse(true);
    try {
      await castVote({
        name: student.name,
        rollNumber: student.rollNumber,
        deviceId,
        boysCandidateId: boysChoice,
        girlsCandidateId: girlsChoice,
      });
      setStage(STAGES.DONE);
    } catch (err) {
      setError(err?.message || "Failed to submit your vote.");
    } finally {
      setLoading(false);
      setSubmitPulse(false);
    }
  }

  const boysName = candidates.boys.find((c) => c.id === boysChoice)?.name;
  const girlsName = candidates.girls.find((c) => c.id === girlsChoice)?.name;

  if (stage === STAGES.SCAN) {
    return (
      <ScanScreen
        error={error}
        scanning={scanning}
        onCameraResult={handleCardScanned}
      />
    );
  }

  if (stage === STAGES.VERIFY || stage === STAGES.ALREADY_VOTED) {
    return (
      <VerificationScreen
        student={student}
        alreadyVoted={stage === STAGES.ALREADY_VOTED}
        error={error}
        loading={loading}
        votingPhase={voting.phase}
        onConfirm={handleConfirmStudent}
        onScanAnother={handleScanAnother}
      />
    );
  }

  if (stage === STAGES.VOTING) {
    return (
      <main className="vote-page vote-page-enter">
        <div className="vote-shell">
          <ElectionHeader student={student} />
          <VotingWindowBanner voting={voting} />
          {error && <ErrorBox message={error} />}

          <section className="ballot-card">
            <div className="ballot-intro">
              <div>
                <div className="section-kicker">YOUR BALLOT</div>
                <h2>Select your CRs</h2>
              </div>
              <div className="ballot-progress">2 selections required</div>
            </div>

            {/* Boys are intentionally shown first. */}
            <ElectorGroup
              title="Boys' CR"
              subtitle="Choose one representative"
              candidates={candidates.boys}
              selected={boysChoice}
              onSelect={setBoysChoice}
              tone="blue"
            />

            <div className="group-divider" />

            <ElectorGroup
              title="Girls' CR"
              subtitle="Choose one representative"
              candidates={candidates.girls}
              selected={girlsChoice}
              onSelect={setGirlsChoice}
              tone="purple"
            />

            <button className="mac-primary-button ballot-submit" onClick={handleGoToConfirm}>
              <span>Review my vote</span>
              <span className="button-arrow">→</span>
            </button>
          </section>

          <p className="privacy-note">Your selection is private and can only be submitted once.</p>
        </div>
      </main>
    );
  }

  if (stage === STAGES.CONFIRM) {
    return (
      <main className="vote-page vote-page-enter">
        <div className="vote-shell confirm-shell">
          <ElectionHeader student={student} compact />
          <VotingWindowBanner voting={voting} />
          {error && <ErrorBox message={error} />}
          <section className="ballot-card confirmation-card">
            <div className="confirm-icon">✓</div>
            <div className="section-kicker">FINAL REVIEW</div>
            <h2>Ready to submit?</h2>
            <p className="confirm-lead">Please check both selections. You cannot change your vote after submission.</p>

            <div className="review-grid">
              <ReviewChoice label="Boys' CR" name={boysName} candidate={candidates.boys.find((c) => c.id === boysChoice)} tone="blue" />
              <ReviewChoice label="Girls' CR" name={girlsName} candidate={candidates.girls.find((c) => c.id === girlsChoice)} tone="purple" />
            </div>

            <div className={`submit-zone ${submitPulse ? "is-submitting" : ""}`}>
              <button className="mac-primary-button ballot-submit" onClick={handleSubmit} disabled={loading || voting.phase === "closed"}>
                {loading ? <><span className="spinner" />Submitting securely…</> : voting.phase === "closed" ? "Voting has closed" : <>Confirm & Submit Vote <span className="button-arrow">→</span></>}
              </button>
              <button className="mac-ghost-button" onClick={() => setStage(STAGES.VOTING)} disabled={loading}>Back to ballot</button>
            </div>
          </section>
        </div>
      </main>
    );
  }

  return <SuccessScreen student={student} />;
}

function ElectionHeader({ student, compact = false }) {
  return (
    <header className={`election-header ${compact ? "compact" : ""}`}>
      <div className="election-brand-row">
        <div className="election-logo">CR</div>
        <div>
          <div className="brand-overline">PICT COLLEGE</div>
          <div className="brand-name">Class Representative Elections</div>
        </div>
        <div className="live-pill"><span /> LIVE</div>
      </div>
      <div className="election-title-wrap">
        <div className="gradient-kicker">FIRST YEAR • FY-08</div>
        <h1>PICT College's First Year<br className="desktop-break" /> <span>FY-08 Division CR Elections</span></h1>
        {!compact && <p>Choose one Boys' CR and one Girls' CR to represent your division.</p>}
      </div>
      {student && (
        <div className="voter-chip">
          <div className="mini-avatar">{initials(student.name)}</div>
          <div><strong>{student.name}</strong><span>Roll No. {student.rollNumber}</span></div>
        </div>
      )}
    </header>
  );
}

function VotingWindowBanner({ voting }) {
  if (voting.phase === "live") {
    return (
      <div className="voting-timer-banner">
        Time remaining to vote: <strong>{formatVotingClock(voting.remainingMs)}</strong>
      </div>
    );
  }
  if (voting.phase === "grace") {
    return (
      <div className="voting-timer-banner is-grace">
        Voting is closing — submit within <strong>{Math.ceil((voting.remainingMs || 0) / 1000)}s</strong>
      </div>
    );
  }
  if (voting.phase === "closed") {
    return (
      <div className="voting-timer-banner is-closed">
        Voting has closed. Your submission may no longer be accepted.
      </div>
    );
  }
  return null;
}

function VerificationScreen({ student, alreadyVoted, error, loading, votingPhase, onConfirm, onScanAnother }) {
  const votingNotLive = !alreadyVoted && votingPhase !== "live";
  const confirmLabel = loading
    ? "Checking election record…"
    : votingPhase === "idle"
    ? "Waiting for voting to start…"
    : votingPhase === "grace" || votingPhase === "closed"
    ? "Voting has ended"
    : "Confirm & Continue";
  return (
    <div className="verify-page-compact" style={verifyPage}>
      <div style={verifyCard} className="verify-card-modern">
        <div style={verifyTopBar}><div style={verifyBrandMark}>CR</div><span>Student verification</span></div>
        <div style={{ padding: "34px 26px 28px" }}>
          <div style={{ ...statusIcon, ...(alreadyVoted ? statusIconDanger : {}) }}>{alreadyVoted ? "!" : "✓"}</div>
          <div style={eyebrow}>{alreadyVoted ? "VOTING ALREADY COMPLETED" : "ID CARD SCANNED"}</div>
          <h1 style={verifyTitle}>{alreadyVoted ? "You have already voted" : "Confirm student details"}</h1>
          <p style={verifySubtitle}>{alreadyVoted ? "This student cannot submit another vote in this election." : "Review the information below before continuing to the ballot."}</p>
          {error && <ErrorBox message={error} />}
          <div style={detailsCard}>
            <Detail label="STUDENT NAME" value={student?.name} full />
            <div style={detailGrid}>
              <Detail label="CLASS" value={student?.division} />
              <Detail label="ROLL NO." value={student?.rollNumber} />
              <Detail label="STUDENT ID" value={student?.misId} />
            </div>
          </div>
          {!alreadyVoted ? (
            <button style={verifyPrimary} onClick={onConfirm} disabled={loading || votingNotLive}>{confirmLabel}</button>
          ) : (
            <button style={verifyPrimary} onClick={onScanAnother}>Scan another card</button>
          )}
          {votingNotLive && (
            <div className="voting-locked-note">
              {votingPhase === "idle"
                ? "Voting isn't started yet. Please wait a while — it will unlock automatically as soon as it begins."
                : "Voting has ended. New votes can no longer be started."}
            </div>
          )}
          {!alreadyVoted && <button style={textButton} onClick={onScanAnother} disabled={loading}>Scan another card</button>}
        </div>
      </div>
    </div>
  );
}

function Detail({ label, value, full }) {
  return <div style={{ ...detailBlock, ...(full ? detailFull : {}) }}><div style={detailLabel}>{label}</div><div style={detailValue}>{value || "—"}</div></div>;
}

function ScanScreen({ error, scanning, onCameraResult }) {
  return (
    <div style={scanScreenWrap}>
      <div style={scanCard}>
        <div style={brandRow}><div style={brandMark}>CR</div><span style={brandText}>Class Representative Election</span></div>
        <h1 style={scanTitle}>Scan your identity card</h1>
        <p style={scanSubtitle}>Place the barcode or QR code inside the frame. It will be detected automatically.</p>
        {error && <ErrorBox message={error} />}
        {scanning && <p style={scanStatus}>Reading student record…</p>}
        <CameraScanner active={!scanning} onResult={onCameraResult} />
      </div>
    </div>
  );
}

function ElectorGroup({ title, subtitle, candidates, selected, onSelect, tone }) {
  return (
    <section className="candidate-section">
      <div className="candidate-section-heading">
        <div><div className={`candidate-kicker ${tone}`}>{tone === "blue" ? "BOYS" : "GIRLS"} • CR</div><h3>{title}</h3><p>{subtitle}</p></div>
        <div className={`candidate-count ${tone}`}>{candidates.length}</div>
      </div>
      {candidates.length === 0 && <p className="empty-candidates">No candidates added yet.</p>}
      <div className="candidate-grid">
        {candidates.map((candidate, index) => (
          <CandidateCard key={candidate.id} candidate={candidate} index={index} selected={selected === candidate.id} onSelect={() => onSelect(candidate.id)} tone={tone} />
        ))}
      </div>
    </section>
  );
}

function CandidateCard({ candidate, index, selected, onSelect, tone }) {
  const palette = tone === "blue"
    ? ["#dbeafe", "#bfdbfe", "#e0e7ff", "#cffafe", "#dbeafe"]
    : ["#f3e8ff", "#fce7f3", "#ede9fe", "#fae8ff", "#e0e7ff"];
  const avatarBg = palette[index % palette.length];
  return (
    <button type="button" className={`candidate-card ${selected ? "selected" : ""}`} onClick={onSelect}>
      <div className="candidate-avatar" style={{ background: avatarBg }}><span>{initials(candidate.name)}</span></div>
      <div className="candidate-copy"><strong>{candidate.name}</strong><span>Candidate {String(index + 1).padStart(2, "0")}</span></div>
      <div className={`selection-indicator ${selected ? "checked" : ""}`}>{selected ? "✓" : ""}</div>
    </button>
  );
}

function ReviewChoice({ label, name, candidate, tone }) {
  return <div className={`review-choice ${tone}`}><div className="review-label">{label}</div><div className="review-person"><div className="candidate-avatar small" style={{ background: tone === "blue" ? "#dbeafe" : "#f3e8ff" }}>{initials(name)}</div><strong>{name}</strong></div></div>;
}

function SuccessScreen({ student }) {
  return (
    <main className="vote-page success-page vote-page-enter">
      <div className="success-glow" />
      <div className="success-card">
        <div className="success-check"><span>✓</span></div>
        <div className="gradient-kicker">VOTE RECORDED</div>
        <h1>Thank you for voting.</h1>
        <p>Your vote has been securely submitted for the FY-08 CR Elections.</p>
        <div className="success-student"><div className="mini-avatar">{initials(student?.name)}</div><div><strong>{student?.name}</strong><span>Vote submitted successfully</span></div></div>
        <div className="success-line"><span /> <small>SECURE • ONE VOTE • FY-08</small> <span /></div>
      </div>
      <div className="success-confetti" aria-hidden="true"><i /><i /><i /><i /><i /><i /><i /><i /></div>
    </main>
  );
}

function initials(name = "") {
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "CR";
  return parts.slice(0, 2).map((p) => p[0]).join("").toUpperCase();
}

function ErrorBox({ message }) { return <div style={errorBox}>{message}</div>; }
function Centered({ children }) { return <div style={{ minHeight: "100vh", display: "flex", justifyContent: "center", padding: "40px 16px" }}><div style={{ width: "100%", maxWidth: 460 }}>{children}</div></div>; }
function CheckBadge() { return <div style={checkBadge}><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg></div>; }

const verifyPage = { minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: "24px 16px", background: "linear-gradient(180deg, #f5f7fb 0%, #eef1f6 100%)" };
const verifyCard = { width: "100%", maxWidth: 500, overflow: "hidden", background: "rgba(255,255,255,0.96)", border: "1px solid #dfe3e9", borderRadius: 24, boxShadow: "0 18px 60px rgba(15,23,42,0.10)" };
const verifyTopBar = { height: 72, display: "flex", alignItems: "center", justifyContent: "center", gap: 10, borderBottom: "1px solid #e7e9ed", fontSize: 16, fontWeight: 650, color: "#60656f" };
const verifyBrandMark = { width: 30, height: 30, borderRadius: 9, display: "grid", placeItems: "center", background: "#17181c", color: "white", fontSize: 11, fontWeight: 800 };
const statusIcon = { width: 76, height: 76, margin: "0 auto 28px", borderRadius: 24, display: "grid", placeItems: "center", background: "#edf9f1", border: "1px solid #c9ead5", color: "#278650", fontSize: 42, fontWeight: 500 };
const statusIconDanger = { background: "#fff1f1", borderColor: "#f4caca", color: "#c93636" };
const eyebrow = { fontSize: 12, letterSpacing: 2.2, fontWeight: 750, color: "#737780", textAlign: "center" };
const verifyTitle = { margin: "12px 0 8px", textAlign: "center", fontSize: 31, lineHeight: 1.08, letterSpacing: -1.2, color: "#111318" };
const verifySubtitle = { maxWidth: 390, margin: "0 auto", textAlign: "center", color: "#777b83", fontSize: 16, lineHeight: 1.5 };
const detailsCard = { marginTop: 28, padding: "4px 22px 8px", border: "1px solid #e1e3e7", borderRadius: 20, background: "#fff" };
const detailBlock = { padding: "20px 0", minWidth: 0 };
const detailFull = { borderBottom: "1px solid #eceef1" };
const detailGrid = { display: "grid", gridTemplateColumns: "1fr 1fr", columnGap: 24 };
const detailLabel = { color: "#858992", fontSize: 11.5, letterSpacing: 1.5, fontWeight: 750, marginBottom: 8 };
const detailValue = { color: "#17191e", fontSize: 18, lineHeight: 1.25, fontWeight: 650, wordBreak: "break-word" };
const verifyPrimary = { width: "100%", marginTop: 22, padding: "15px 18px", border: "none", borderRadius: 14, background: "#17181c", color: "#fff", fontSize: 16, fontWeight: 700, boxShadow: "0 8px 20px rgba(23,24,28,0.16)" };
const textButton = { width: "100%", marginTop: 14, padding: "10px", border: "none", background: "transparent", color: "#747880", fontSize: 14, fontWeight: 600 };
const scanScreenWrap = { minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: "24px 16px", background: "linear-gradient(180deg, #f4f7fc 0%, #eef2f9 100%)" };
const scanCard = { width: "100%", maxWidth: 440, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 20, padding: "36px 28px 32px", textAlign: "center", boxShadow: "0 8px 30px rgba(15,23,42,0.08)", color: "var(--text)" };
const brandRow = { display: "flex", alignItems: "center", justifyContent: "center", gap: 10, marginBottom: 22 };
const brandMark = { width: 34, height: 34, borderRadius: 10, background: "var(--primary)", color: "#fff", fontWeight: 700, fontSize: 13, display: "flex", alignItems: "center", justifyContent: "center" };
const brandText = { fontSize: 13, fontWeight: 600, color: "var(--text-muted)" };
const scanTitle = { fontSize: 24, fontWeight: 750, margin: "0 0 8px", lineHeight: 1.25 };
const scanSubtitle = { fontSize: 14, color: "var(--text-muted)", margin: "0 0 4px", lineHeight: 1.5 };
const scanStatus = { fontSize: 13.5, color: "var(--primary-dark)", marginTop: 16, fontWeight: 650 };
const tabRow = { display: "flex", gap: 6, background: "#f1f5f9", borderRadius: 10, padding: 4, marginTop: 22, marginBottom: 6 };
const tabButton = { flex: 1, padding: "9px 6px", borderRadius: 8, border: "none", background: "transparent", color: "var(--text-muted)", fontSize: 12.5, fontWeight: 600 };
const tabButtonActive = { background: "#fff", color: "var(--primary)", boxShadow: "0 1px 3px rgba(15,23,42,0.12)" };
const inputStyle = { width: "100%", padding: "12px", borderRadius: 10, border: "1px solid var(--border)", background: "#fff", color: "var(--text)", fontSize: 15 };
const primaryButton = { width: "100%", marginTop: 14, padding: "13px", borderRadius: 10, border: "none", background: "var(--primary)", color: "#fff", fontWeight: 650, fontSize: 15 };
const errorBox = { background: "var(--danger-bg)", border: "1px solid #fecaca", color: "var(--danger)", padding: 12, borderRadius: 10, marginTop: 16, marginBottom: 4, fontSize: 14, textAlign: "left" };
const checkBadge = { width: 60, height: 60, borderRadius: "50%", background: "var(--success)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 20px" };
