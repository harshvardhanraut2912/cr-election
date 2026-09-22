import { useEffect, useRef, useState } from "react";
import jsQR from "jsqr";
import { decodeCode128 } from "./code128Decoder.js";

const NATIVE_FORMATS = ["code_128", "qr_code"];
const FALLBACK_WIDTH = 900;
const QR_WIDTH = 620;
const FALLBACK_SCAN_INTERVAL_MS = 35;
const DETECTED_FLASH_MS = 120;

/**
 * Fast ID-card scanner + student confirmation flow.
 *
 * Props:
 *  - onResult(value) -> called only after the student is verified and has NOT voted.
 *  - active -> enables/disables scanner.
 *  - verifyStudent(value) -> optional async function supplied by the parent.
 *      It should return:
 *        { found: true, student: {...}, hasVoted: boolean }
 *      If omitted, the component attempts to use an already-initialized Firebase
 *      app and looks in the collections configured below.
 *  - onReset() -> optional callback when the operator chooses scan another card.
 */
export default function CameraScanner({ onResult, active, lookupStudent, verifyStudent, onReset }) {
  const videoRef = useRef(null);
  const qrCanvasRef = useRef(document.createElement("canvas"));
  const barcodeCanvasRef = useRef(document.createElement("canvas"));
  const streamRef = useRef(null);
  const rafRef = useRef(null);
  const hasResultRef = useRef(false);
  const lastScanRef = useRef(0);
  const detectorRef = useRef(null);
  const busyRef = useRef(false);
  const onResultRef = useRef(onResult);
  const verifyStudentRef = useRef(verifyStudent);
  const lookupStudentRef = useRef(lookupStudent);
  const mountedRef = useRef(true);

  const [status, setStatus] = useState("starting");
  const [torchOn, setTorchOn] = useState(false);
  const [torchAvailable, setTorchAvailable] = useState(false);
  const [stage, setStage] = useState("scan");
  const [student, setStudent] = useState(null);
  const [scannedValue, setScannedValue] = useState("");
  const [verifyState, setVerifyState] = useState("idle");
  const [verifyMessage, setVerifyMessage] = useState("");
  const [lookupState, setLookupState] = useState("idle");

  useEffect(() => {
    const id = "student-vote-scanner-keyframes";
    if (!document.getElementById(id)) {
      const style = document.createElement("style");
      style.id = id;
      style.textContent = "@keyframes spin { to { transform: rotate(360deg); } }";
      document.head.appendChild(style);
    }
  }, []);

  useEffect(() => { onResultRef.current = onResult; }, [onResult]);
  useEffect(() => { verifyStudentRef.current = verifyStudent; }, [verifyStudent]);
  useEffect(() => { lookupStudentRef.current = lookupStudent; }, [lookupStudent]);

  useEffect(() => {
    if (!active) return undefined;

    mountedRef.current = true;
    hasResultRef.current = false;
    busyRef.current = false;
    lastScanRef.current = 0;
    setStatus("starting");
    setStage("scan");
    setStudent(null);
    setScannedValue("");
    setVerifyState("idle");
    setVerifyMessage("");
    setLookupState("idle");
    setTorchOn(false);

    let cancelled = false;
    let handoffTimer = null;

    const getLegacyGetUserMedia = () =>
      navigator.getUserMedia || navigator.webkitGetUserMedia || navigator.mozGetUserMedia || navigator.msGetUserMedia;

    const getUserMediaCompat = (constraints) => {
      if (navigator.mediaDevices?.getUserMedia) return navigator.mediaDevices.getUserMedia(constraints);
      const legacy = getLegacyGetUserMedia();
      if (!legacy) return Promise.reject(new Error("Camera API unavailable"));
      return new Promise((resolve, reject) => legacy.call(navigator, constraints, resolve, reject));
    };

    async function loadStudentDetails(cleanValue) {
      if (!lookupStudentRef.current) {
        setLookupState("error");
        setVerifyMessage("Student lookup is not configured.");
        return;
      }

      setLookupState("loading");
      try {
        const result = await lookupStudentRef.current(cleanValue);
        if (!result) throw new Error("Student record could not be found.");
        if (!mountedRef.current || cancelled) return;
        setStudent(result);
        setLookupState("ready");
      } catch (error) {
        if (!mountedRef.current || cancelled) return;
        setStudent(null);
        setLookupState("error");
        setVerifyMessage(error?.message || "Student record could not be found. Please scan the ID card again.");
      }
    }

    function handleDetected(value) {
      const cleanValue = String(value || "").trim();
      if (!cleanValue || hasResultRef.current || cancelled) return;

      hasResultRef.current = true;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      setScannedValue(cleanValue);
      setStatus("detected");
      setStage("student");
      setLookupState("loading");
      handoffTimer = setTimeout(() => {
        if (!cancelled && mountedRef.current) loadStudentDetails(cleanValue);
      }, DETECTED_FLASH_MS);
    }

    async function tickNative() {
      if (cancelled || hasResultRef.current) return;
      rafRef.current = requestAnimationFrame(tickNative);
      if (busyRef.current) return;

      const video = videoRef.current;
      if (!video || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;

      busyRef.current = true;
      try {
        const codes = await detectorRef.current.detect(video);
        const hit = codes?.find((code) => code?.rawValue);
        if (!cancelled && hit?.rawValue) handleDetected(hit.rawValue);
      } catch {
        // Autofocus/exposure can temporarily make a frame undecodable.
      } finally {
        busyRef.current = false;
      }
    }

    function drawScaled(video, canvas, targetWidth) {
      const scale = Math.min(1, targetWidth / video.videoWidth);
      const width = Math.max(1, Math.round(video.videoWidth * scale));
      const height = Math.max(1, Math.round(video.videoHeight * scale));
      if (canvas.width !== width) canvas.width = width;
      if (canvas.height !== height) canvas.height = height;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      ctx.drawImage(video, 0, 0, width, height);
      return ctx;
    }

    function tickFallback(timestamp) {
      if (cancelled || hasResultRef.current) return;
      rafRef.current = requestAnimationFrame(tickFallback);
      if (timestamp - lastScanRef.current < FALLBACK_SCAN_INTERVAL_MS) return;

      const video = videoRef.current;
      if (!video || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || !video.videoWidth) return;
      lastScanRef.current = timestamp;

      const qrCtx = drawScaled(video, qrCanvasRef.current, QR_WIDTH);
      const qrData = qrCtx.getImageData(0, 0, qrCanvasRef.current.width, qrCanvasRef.current.height);
      const qr = jsQR(qrData.data, qrData.width, qrData.height, { inversionAttempts: "attemptBoth" });
      if (qr?.data) {
        handleDetected(qr.data);
        return;
      }

      const barcodeCtx = drawScaled(video, barcodeCanvasRef.current, FALLBACK_WIDTH);
      const barcodeData = barcodeCtx.getImageData(0, 0, barcodeCanvasRef.current.width, barcodeCanvasRef.current.height);
      const code128 = decodeCode128(barcodeData, 11);
      if (code128) handleDetected(code128);
    }

    async function start() {
      if (!window.isSecureContext && location.hostname !== "localhost") {
        setStatus("insecure");
        return;
      }
      if (!navigator.mediaDevices?.getUserMedia && !getLegacyGetUserMedia()) {
        setStatus("unsupported");
        return;
      }

      try {
        const stream = await getUserMediaCompat({
          video: {
            facingMode: { ideal: "environment" },
            width: { ideal: 1920, min: 1280 },
            height: { ideal: 1080, min: 720 },
            frameRate: { ideal: 60, max: 60 },
          },
          audio: false,
        });

        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        streamRef.current = stream;
        const track = stream.getVideoTracks()[0];
        const capabilities = track?.getCapabilities?.() || {};
        setTorchAvailable(!!capabilities.torch);

        try {
          const advanced = [];
          if (capabilities.focusMode?.includes?.("continuous")) advanced.push({ focusMode: "continuous" });
          if (capabilities.exposureMode?.includes?.("continuous")) advanced.push({ exposureMode: "continuous" });
          if (advanced.length) await track.applyConstraints({ advanced });
        } catch {}

        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }

        detectorRef.current = null;
        if ("BarcodeDetector" in window) {
          try {
            const supported = typeof window.BarcodeDetector.getSupportedFormats === "function"
              ? await window.BarcodeDetector.getSupportedFormats()
              : NATIVE_FORMATS;
            const formats = NATIVE_FORMATS.filter((format) => supported.includes(format));
            if (formats.includes("code_128")) detectorRef.current = new window.BarcodeDetector({ formats });
          } catch {
            detectorRef.current = null;
          }
        }

        setStatus("ready");
        rafRef.current = requestAnimationFrame(detectorRef.current ? tickNative : tickFallback);
      } catch {
        setStatus("denied");
      }
    }

    start();

    return () => {
      cancelled = true;
      mountedRef.current = false;
      if (handoffTimer) clearTimeout(handoffTimer);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
      }
      detectorRef.current = null;
    };
  }, [active]);


  async function confirmStudent() {
    if (!scannedValue || !student || lookupState !== "ready" || verifyState === "checking") return;
    if (!verifyStudentRef.current) {
      setVerifyState("error");
      setVerifyMessage("Vote verification is not configured.");
      return;
    }

    setVerifyState("checking");
    setVerifyMessage("");

    try {
      await verifyStudentRef.current(scannedValue, student);
      setVerifyState("verified");
      setVerifyMessage("");
      onResultRef.current?.(scannedValue, student);
    } catch (error) {
      const message = error?.message || "Unable to verify the student's vote status right now.";
      setVerifyState(message.toLowerCase().includes("already") ? "voted" : "error");
      setVerifyMessage(message);
    }
  }

  function resetScanner() {
    setStage("scan");
    setStudent(null);
    setScannedValue("");
    setVerifyState("idle");
    setVerifyMessage("");
    setLookupState("idle");
    hasResultRef.current = false;
    setStatus("starting");
    onReset?.();
  }

  async function toggleTorch() {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;
    try {
      const next = !torchOn;
      await track.applyConstraints({ advanced: [{ torch: next }] });
      setTorchOn(next);
    } catch {}
  }

  if (!active) return null;

  if (stage === "student") {
    return (
      <div style={page}>
        <div style={macWindow}>
          <div style={windowBar}>
            <div style={trafficLights}><i/><i/><i/></div>
            <div style={windowTitle}>Student verification</div>
            <div style={{ width: 52 }} />
          </div>

          <div style={content}>
            <div style={successIcon}>
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="m5 12 4 4L19 6"/></svg>
            </div>
            <div style={eyebrow}>ID CARD SCANNED</div>
            <h2 style={heading}>Confirm student details</h2>
            <p style={subheading}>Review the information before continuing to the ballot.</p>

            <div style={detailsCard}>
              {lookupState === "loading" ? (
                <div style={lookupLoading}>
                  <Spinner dark />
                  <div>Finding student in the college roster…</div>
                </div>
              ) : (
                <>
                  <Detail label="Student name" value={getStudentName(student) || "—"} prominent />
                  <div style={divider}/>
                  <div style={detailGrid}>
                    <Detail label="Class" value={getField(student, ["class", "year", "division"]) || "—"} />
                    <Detail label="Roll no." value={getField(student, ["rollNo", "rollNumber", "roll"]) || "—"} />
                    <Detail label="Student ID" value={getField(student, ["misId", "mis_id"]) || scannedValue} />
                    <Detail label="PRN" value={getField(student, ["prn", "PRN"]) || "—"} />
                  </div>
                </>
              )}
            </div>

            {lookupState === "error" && <Message type="error">{verifyMessage}</Message>}
            {verifyState === "voted" && <Message type="warning">{verifyMessage}</Message>}
            {verifyState === "error" && lookupState !== "error" && <Message type="error">{verifyMessage}</Message>}
            {verifyState === "verified" && <Message type="success">Student verified. Opening ballot…</Message>}

            <button type="button" disabled={lookupState !== "ready" || verifyState === "checking" || verifyState === "verified" || verifyState === "voted"} style={confirmButton} onClick={confirmStudent}>
              {verifyState === "checking" ? <><Spinner/> Checking vote status…</> : "Confirm & Continue"}
            </button>
            <button type="button" style={secondaryButton} onClick={resetScanner}>Scan another card</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={page}>
      <div style={macWindow}>
        <div style={windowBar}>
          <div style={trafficLights}><i/><i/><i/></div>
          <div style={windowTitle}>Student voting · ID scanner</div>
          <div style={{ width: 52 }} />
        </div>

        <div style={scannerContent}>
          <div style={scannerHeader}>
            <div>
              <div style={eyebrow}>STUDENT VOTING</div>
              <h2 style={heading}>Scan student ID</h2>
              <p style={subheading}>Position the barcode inside the frame. Scanning starts automatically.</p>
            </div>
            <div style={livePill}><span/> Live</div>
          </div>

          <div style={viewportFrame}>
            <video ref={videoRef} playsInline muted autoPlay style={videoStyle}/>
            {status === "ready" && <div style={reticle}>
              <span style={{ ...corner, top: 0, left: 0, borderRight: "none", borderBottom: "none" }}/>
              <span style={{ ...corner, top: 0, right: 0, borderLeft: "none", borderBottom: "none" }}/>
              <span style={{ ...corner, bottom: 0, left: 0, borderRight: "none", borderTop: "none" }}/>
              <span style={{ ...corner, bottom: 0, right: 0, borderLeft: "none", borderTop: "none" }}/>
              <div style={scanLine}/>
            </div>}
            {status === "detected" && <div style={detectedOverlay}><div style={detectedBadge}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="m5 12 4 4L19 6"/></svg> Card detected</div></div>}
            {status === "starting" && <Overlay>Starting camera…</Overlay>}
            {status === "denied" && <Overlay>Camera access was blocked. Allow camera permission for this site, then reload.</Overlay>}
            {status === "insecure" && <Overlay>Camera access needs a secure HTTPS page.</Overlay>}
            {status === "unsupported" && <Overlay>This browser does not support camera scanning.</Overlay>}
          </div>

          <div style={scannerFooter}>
            <span style={status === "ready" ? readyDot : mutedDot}/>
            <span>{status === "ready" ? "Ready to scan" : status === "detected" ? "Reading card…" : "Preparing scanner…"}</span>
            {torchAvailable && status === "ready" && <button type="button" style={torchButton} onClick={toggleTorch}>{torchOn ? "Flash off" : "Flash"}</button>}
          </div>
        </div>
      </div>
    </div>
  );
}

function getField(student, fields) {
  for (const field of fields) {
    const value = student?.[field];
    if (value !== undefined && value !== null && String(value).trim()) return String(value);
  }
  return "";
}

function getStudentName(student) {
  const full = getField(student, ["name", "fullName", "studentName"]);
  if (full) return full;
  const first = getField(student, ["firstName", "first_name"]);
  const last = getField(student, ["lastName", "last_name"]);
  return [first, last].filter(Boolean).join(" ");
}

function Detail({ label, value, prominent }) {
  return <div><div style={detailLabel}>{label}</div><div style={prominent ? detailName : detailValue}>{value}</div></div>;
}

function Message({ type, children }) {
  const styles = {
    warning: { background: "#fff8e6", color: "#8a5a00", border: "#f2d18a" },
    error: { background: "#fff0f0", color: "#a12222", border: "#efb1b1" },
    success: { background: "#edf9f1", color: "#176b36", border: "#b6dfc2" },
  }[type];
  return <div style={{ ...message, ...styles }}>{children}</div>;
}

function Spinner({ dark = false }) { return <span style={{ ...spinner, ...(dark ? spinnerDark : {}) }}/>; }
function Overlay({ children }) { return <div style={overlay}>{children}</div>; }

const page = { width: "100%", display: "flex", justifyContent: "center", padding: "18px 12px", boxSizing: "border-box" };
const macWindow = { width: "100%", maxWidth: 620, border: "1px solid #d9dce1", borderRadius: 18, background: "rgba(255,255,255,.96)", boxShadow: "0 24px 70px rgba(20,25,35,.14), 0 3px 12px rgba(20,25,35,.06)", overflow: "hidden", fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Display', 'SF Pro Text', Inter, system-ui, sans-serif", color: "#16181d" };
const windowBar = { height: 46, background: "linear-gradient(#fafafa,#f4f4f5)", borderBottom: "1px solid #e2e3e6", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 16px", boxSizing: "border-box" };
const trafficLights = { display: "flex", gap: 7, width: 52 };
const windowTitle = { fontSize: 13, fontWeight: 600, color: "#62656c", letterSpacing: ".01em" };
const content = { padding: "30px 30px 26px", textAlign: "center" };
const scannerContent = { padding: "26px 28px 24px" };
const scannerHeader = { display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 18, marginBottom: 20 };
const eyebrow = { fontSize: 10.5, fontWeight: 700, letterSpacing: ".14em", color: "#7b7f87", marginBottom: 7 };
const heading = { fontSize: 25, lineHeight: 1.15, margin: 0, letterSpacing: "-.035em", fontWeight: 700 };
const subheading = { color: "#777b83", fontSize: 13.5, lineHeight: 1.55, margin: "8px 0 0", maxWidth: 460 };
const successIcon = { width: 54, height: 54, margin: "0 auto 15px", borderRadius: 16, display: "grid", placeItems: "center", background: "#edf9f1", color: "#23864b", border: "1px solid #cdebd7" };
const detailsCard = { marginTop: 22, padding: "20px 21px", border: "1px solid #e3e5e9", borderRadius: 15, background: "linear-gradient(180deg,#fff,#fafbfc)", textAlign: "left", boxShadow: "0 8px 24px rgba(20,25,35,.045)" };
const divider = { height: 1, background: "#eceef1", margin: "17px 0" };
const detailGrid = { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "17px 24px" };
const detailLabel = { fontSize: 10.5, textTransform: "uppercase", letterSpacing: ".1em", color: "#92959c", fontWeight: 650, marginBottom: 5 };
const detailName = { fontSize: 19, fontWeight: 650, letterSpacing: "-.02em", color: "#17191e" };
const detailValue = { fontSize: 14.5, fontWeight: 560, color: "#30343b", wordBreak: "break-word" };
const confirmButton = { width: "100%", marginTop: 18, height: 48, border: 0, borderRadius: 12, background: "#17191e", color: "white", fontSize: 14, fontWeight: 650, cursor: "pointer", boxShadow: "0 8px 18px rgba(20,22,26,.15)", display: "flex", alignItems: "center", justifyContent: "center", gap: 9 };
const secondaryButton = { marginTop: 9, border: 0, background: "transparent", color: "#686c74", fontSize: 13, fontWeight: 600, cursor: "pointer", padding: "8px 12px" };
const message = { marginTop: 15, border: "1px solid", borderRadius: 11, padding: "11px 13px", textAlign: "left", fontSize: 13, lineHeight: 1.45, fontWeight: 550 };
const spinner = { width: 14, height: 14, border: "2px solid rgba(255,255,255,.4)", borderTopColor: "#fff", borderRadius: "50%", display: "inline-block", animation: "spin .7s linear infinite" };
const spinnerDark = { borderColor: "#d9dce1", borderTopColor: "#17191e" };
const lookupLoading = { minHeight: 150, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12, color: "#777b83", fontSize: 13.5, fontWeight: 550 };
const livePill = { flex: "0 0 auto", display: "flex", alignItems: "center", gap: 6, padding: "6px 9px", borderRadius: 999, background: "#f4f5f6", border: "1px solid #e6e7e9", fontSize: 11, fontWeight: 650, color: "#666a72" };
const viewportFrame = { position: "relative", width: "100%", maxWidth: 520, margin: "0 auto", aspectRatio: "1.78 / 1", borderRadius: 15, overflow: "hidden", background: "#080b10", boxShadow: "inset 0 0 0 1px rgba(255,255,255,.08)" };
const videoStyle = { width: "100%", height: "100%", objectFit: "cover" };
const overlay = { position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", padding: 25, textAlign: "center", color: "#e8eaf0", fontSize: 13.5, lineHeight: 1.5, background: "rgba(8,11,16,.88)" };
const reticle = { position: "absolute", inset: "16% 8%", pointerEvents: "none" };
const corner = { position: "absolute", width: 30, height: 30, border: "3px solid #fff", borderRadius: 5, filter: "drop-shadow(0 0 4px rgba(0,0,0,.35))" };
const scanLine = { position: "absolute", left: 2, right: 2, top: "50%", height: 2, background: "#fff", opacity: .85, boxShadow: "0 0 9px rgba(255,255,255,.9)" };
const detectedOverlay = { position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(15,20,25,.28)" };
const detectedBadge = { display: "flex", alignItems: "center", gap: 7, background: "rgba(25,29,34,.88)", color: "#fff", fontWeight: 650, fontSize: 13, padding: "9px 14px", borderRadius: 999, boxShadow: "0 8px 25px rgba(0,0,0,.25)" };
const scannerFooter = { display: "flex", alignItems: "center", justifyContent: "center", gap: 7, marginTop: 13, minHeight: 34, color: "#777b83", fontSize: 12.5 };
const readyDot = { width: 7, height: 7, borderRadius: "50%", background: "#34a853", boxShadow: "0 0 0 3px rgba(52,168,83,.12)" };
const mutedDot = { width: 7, height: 7, borderRadius: "50%", background: "#a4a8af" };
const torchButton = { marginLeft: 7, border: "1px solid #dedfe2", background: "#fff", color: "#565a62", borderRadius: 8, padding: "5px 9px", fontSize: 11.5, cursor: "pointer" };

