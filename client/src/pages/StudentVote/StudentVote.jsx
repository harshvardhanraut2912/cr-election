import { useMemo, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { getDeviceToken } from "../../utils/deviceToken.js";
import { lookupStudentByCard, validateVoter, getCandidates, castVote } from "../../services/api.js";
import CameraScanner from "./CameraScanner.jsx";

const STAGES = { SCAN: "SCAN", WELCOME: "WELCOME", VOTING: "VOTING", CONFIRM: "CONFIRM", DONE: "DONE" };
const SCAN_MODES = { CAMERA: "CAMERA", MANUAL: "MANUAL" };

export default function StudentVote() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const rollFromUrl = searchParams.get("election");

  const [stage, setStage] = useState(STAGES.SCAN);
  const [name, setName] = useState("");
  const [rollNumber, setRollNumber] = useState(rollFromUrl || "");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scanMode, setScanMode] = useState(SCAN_MODES.CAMERA);

  const [candidates, setCandidates] = useState({ boys: [], girls: [] });
  const [boysChoice, setBoysChoice] = useState(null);
  const [girlsChoice, setGirlsChoice] = useState(null);

  const deviceId = useMemo(() => getDeviceToken(), []);

  async function handleCardScanned(rawValue) {
    const misId = String(rawValue || "").trim();
    if (!misId) return;
    setError("");
    setScanning(true);
    try {
      const student = await lookupStudentByCard(misId);
      setName(student.name);
      setRollNumber(String(student.rollNumber));
      setStage(STAGES.WELCOME);

      setLoading(true);
      await validateVoter({ name: student.name, rollNumber: student.rollNumber, deviceId });
      const data = await getCandidates();
      setCandidates(data);
      navigate(`/student/vote?election=${encodeURIComponent(String(student.rollNumber))}`, { replace: true });
      setTimeout(() => setStage(STAGES.VOTING), 900);
    } catch (err) {
      setError(err.message);
      setStage(STAGES.SCAN);
    } finally {
      setScanning(false);
      setLoading(false);
    }
  }

  // Camera flow: the scanner first loads the identity details from
  // server/data/students.json. Only after the operator presses
  // “Confirm & Continue” do we query Firebase via validateVoter.
  async function lookupScannedStudent(misId) {
    return lookupStudentByCard(misId);
  }

  async function verifyScannedStudent(_misId, student) {
    setError("");
    await validateVoter({
      name: student.name,
      rollNumber: student.rollNumber,
      deviceId,
    });
  }

  async function handleCameraVerified(_misId, student) {
    setError("");
    setName(student.name);
    setRollNumber(String(student.rollNumber));
    setLoading(true);

    try {
      const data = await getCandidates();
      setCandidates(data);
      navigate(`/student/vote?election=${encodeURIComponent(String(student.rollNumber))}`, { replace: true });
      setStage(STAGES.VOTING);
    } catch (err) {
      setError(err.message);
      setStage(STAGES.SCAN);
    } finally {
      setLoading(false);
    }
  }

  function handleGoToConfirm() {
    if (!boysChoice || !girlsChoice) {
      setError("Please select one Boys elector and one Girls elector.");
      return;
    }
    setError("");
    setStage(STAGES.CONFIRM);
  }

  async function handleSubmit() {
    setLoading(true);
    setError("");
    try {
      await castVote({
        name,
        rollNumber,
        deviceId,
        boysCandidateId: boysChoice,
        girlsCandidateId: girlsChoice,
      });
      setStage(STAGES.DONE);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  const boysName = candidates.boys.find((c) => c.id === boysChoice)?.name;
  const girlsName = candidates.girls.find((c) => c.id === girlsChoice)?.name;

  if (stage === STAGES.SCAN) {
    return (
      <ScanScreen
        error={error}
        scanning={scanning}
        scanMode={scanMode}
        setScanMode={setScanMode}
        onManualSubmit={handleCardScanned}
      />
    );
  }

  if (stage === STAGES.WELCOME) {
    return (
      <Centered>
        <div style={{ ...cardStyle, textAlign: "center", padding: "40px 24px" }}>
          <CheckBadge />
          <h2 style={{ margin: "16px 0 4px" }}>Welcome, {name.split(" ")[0]}</h2>
          <p style={{ color: "var(--text-muted)", margin: 0 }}>Roll No. {rollNumber} &middot; Loading ballot…</p>
        </div>
      </Centered>
    );
  }

  return (
    <Centered>
      <h1 style={{ marginBottom: 4, fontSize: 24 }}>Class Representative Election</h1>
      <p style={{ color: "var(--text-muted)", marginTop: 0 }}>
        {name} &middot; Roll No. {rollNumber}
      </p>

      {error && <ErrorBox message={error} />}

      {stage === STAGES.VOTING && (
        <div style={cardStyle}>
          <ElectorGroup title="Boys CR" candidates={candidates.boys} selected={boysChoice} onSelect={setBoysChoice} />
          <ElectorGroup title="Girls CR" candidates={candidates.girls} selected={girlsChoice} onSelect={setGirlsChoice} />
          <button style={primaryButton} onClick={handleGoToConfirm}>
            Submit Vote
          </button>
        </div>
      )}

      {stage === STAGES.CONFIRM && (
        <div style={cardStyle}>
          <h3 style={{ marginTop: 0 }}>You are voting for:</h3>
          <p>Boys CR: <strong>{boysName}</strong></p>
          <p>Girls CR: <strong>{girlsName}</strong></p>
          <p style={{ color: "#b45309" }}>Your vote cannot be changed after submission.</p>
          <button style={primaryButton} onClick={handleSubmit} disabled={loading}>
            {loading ? "Submitting..." : "Confirm & Submit"}
          </button>
          <button style={secondaryButton} onClick={() => setStage(STAGES.VOTING)} disabled={loading}>
            Back
          </button>
        </div>
      )}

      {stage === STAGES.DONE && (
        <div style={{ ...cardStyle, textAlign: "center" }}>
          <h2 style={{ color: "var(--success)" }}>Your vote is submitted</h2>
          <p style={{ color: "var(--text-muted)" }}>Thank you for voting.</p>
        </div>
      )}
    </Centered>
  );
}

function ScanScreen({ error, scanning, scanMode, setScanMode, onManualSubmit }) {
  const [manualValue, setManualValue] = useState("");

  return (
    <div style={scanScreenWrap}>
      <div style={scanCard}>
        <div style={brandRow}>
          <div style={brandMark}>CR</div>
          <span style={brandText}>Class Representative Election</span>
        </div>

        <h1 style={scanTitle}>Scan your identity card to enter voting</h1>
        <p style={scanSubtitle}>
          Use your camera to scan the QR code on your college ID, or choose another option below.
        </p>

        <div style={tabRow}>
          <TabButton active={scanMode === SCAN_MODES.CAMERA} onClick={() => setScanMode(SCAN_MODES.CAMERA)}>
            Camera ID scanner
          </TabButton>
          <TabButton active={scanMode === SCAN_MODES.MANUAL} onClick={() => setScanMode(SCAN_MODES.MANUAL)}>
            Enter manually
          </TabButton>
        </div>

        {scanning && <p style={scanStatus}>Verifying card…</p>}
        {error && <ErrorBox message={error} />}

        {scanMode === SCAN_MODES.CAMERA && (
          <CameraScanner
            active={scanMode === SCAN_MODES.CAMERA}
            lookupStudent={lookupScannedStudent}
            verifyStudent={verifyScannedStudent}
            onResult={handleCameraVerified}
          />
        )}

        {scanMode === SCAN_MODES.MANUAL && (
          <form
            style={{ marginTop: 20 }}
            onSubmit={(e) => {
              e.preventDefault();
              onManualSubmit(manualValue);
            }}
          >
            <input
              autoFocus
              style={inputStyle}
              placeholder="e.g. F260243"
              value={manualValue}
              onChange={(e) => setManualValue(e.target.value)}
            />
            <button type="submit" style={primaryButton} disabled={scanning}>
              {scanning ? "Checking..." : "Continue"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

function TabButton({ active, onClick, children }) {
  return (
    <button type="button" onClick={onClick} style={{ ...tabButton, ...(active ? tabButtonActive : {}) }}>
      {children}
    </button>
  );
}

function ElectorGroup({ title, candidates, selected, onSelect }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <h3 style={{ marginBottom: 8 }}>{title}</h3>
      {candidates.length === 0 && <p style={{ color: "var(--text-muted)", fontSize: 14 }}>No electors added yet.</p>}
      {candidates.map((c) => (
        <label key={c.id} style={{ ...radioRow, ...(selected === c.id ? radioRowSelected : {}) }}>
          <input type="radio" name={title} checked={selected === c.id} onChange={() => onSelect(c.id)} />
          <span style={{ marginLeft: 10 }}>{c.name}</span>
        </label>
      ))}
    </div>
  );
}

function Centered({ children }) {
  return (
    <div style={{ minHeight: "100vh", display: "flex", justifyContent: "center", padding: "40px 16px" }}>
      <div style={{ width: "100%", maxWidth: 460 }}>{children}</div>
    </div>
  );
}

function ErrorBox({ message }) {
  return (
    <div style={{ background: "var(--danger-bg)", border: "1px solid #fecaca", color: "var(--danger)", padding: 12, borderRadius: 8, marginTop: 16, marginBottom: 4, fontSize: 14, textAlign: "left" }}>
      {message}
    </div>
  );
}

function CheckBadge() {
  return (
    <div style={{ width: 56, height: 56, borderRadius: "50%", background: "var(--success)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto" }}>
      <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="20 6 9 17 4 12" />
      </svg>
    </div>
  );
}

const cardStyle = { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: 24, marginTop: 16, boxShadow: "0 1px 3px rgba(0,0,0,0.04)" };
const inputStyle = { width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "#fff", color: "var(--text)", fontSize: 15, marginBottom: 4 };
const primaryButton = { width: "100%", marginTop: 14, padding: "13px", borderRadius: 8, border: "none", background: "var(--primary)", color: "#fff", fontWeight: 600, fontSize: 15 };
const secondaryButton = { ...primaryButton, marginTop: 10, background: "transparent", border: "1px solid var(--border)", color: "var(--text-muted)" };
const radioRow = { display: "flex", alignItems: "center", padding: "10px 12px", cursor: "pointer", borderRadius: 8, border: "1px solid var(--border)", marginBottom: 6 };
const radioRowSelected = { borderColor: "var(--primary)", background: "#eff6ff" };

// ---- Scan screen styling (bright, professional theme) ----
const scanScreenWrap = {
  minHeight: "100vh",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "24px 16px",
  background: "linear-gradient(180deg, #f4f7fc 0%, #eef2f9 100%)",
};

const scanCard = {
  width: "100%",
  maxWidth: 440,
  background: "var(--surface)",
  border: "1px solid var(--border)",
  borderRadius: 20,
  padding: "36px 28px 32px",
  textAlign: "center",
  boxShadow: "0 8px 30px rgba(15,23,42,0.08)",
  color: "var(--text)",
};

const brandRow = { display: "flex", alignItems: "center", justifyContent: "center", gap: 10, marginBottom: 22 };

const brandMark = {
  width: 34,
  height: 34,
  borderRadius: 10,
  background: "var(--primary)",
  color: "#fff",
  fontWeight: 700,
  fontSize: 13,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  letterSpacing: 0.3,
};

const brandText = { fontSize: 13, fontWeight: 600, color: "var(--text-muted)", letterSpacing: 0.2 };

const scanTitle = { fontSize: 21, fontWeight: 700, margin: "0 0 8px", lineHeight: 1.3, color: "var(--text)" };
const scanSubtitle = { fontSize: 14, color: "var(--text-muted)", margin: "0 0 4px", lineHeight: 1.5 };
const scanStatus = { fontSize: 13.5, color: "var(--primary-dark)", marginTop: 16, fontWeight: 600, letterSpacing: 0.2 };

const tabRow = {
  display: "flex",
  gap: 6,
  background: "#f1f5f9",
  borderRadius: 10,
  padding: 4,
  marginTop: 22,
  marginBottom: 6,
};

const tabButton = {
  flex: 1,
  padding: "9px 6px",
  borderRadius: 8,
  border: "none",
  background: "transparent",
  color: "var(--text-muted)",
  fontSize: 12.5,
  fontWeight: 600,
  transition: "all 0.15s ease",
};

const tabButtonActive = {
  background: "#fff",
  color: "var(--primary)",
  boxShadow: "0 1px 3px rgba(15,23,42,0.12)",
};

const linkButton = {
  marginTop: 22,
  background: "transparent",
  border: "none",
  color: "var(--text-muted)",
  fontSize: 13,
  textDecoration: "underline",
  padding: 0,
};
