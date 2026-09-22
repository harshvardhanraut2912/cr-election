import { useEffect, useRef, useState } from "react";
import jsQR from "jsqr";
import { decodeCode128 } from "./code128Decoder.js";

// The ID cards in this project use a horizontal Code 128 barcode (for example
// F260243), not a QR code. Keep QR support too, but Code 128 is the primary
// fallback when BarcodeDetector is unavailable.
const NATIVE_FORMATS = ["code_128", "qr_code"];

const FALLBACK_WIDTH = 720;
const QR_WIDTH = 480;
const FALLBACK_SCAN_INTERVAL_MS = 55;
const DETECTED_FLASH_MS = 120;

export default function CameraScanner({ onResult, active }) {
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

  useEffect(() => {
    onResultRef.current = onResult;
  }, [onResult]);

  const [status, setStatus] = useState("starting");
  const [torchOn, setTorchOn] = useState(false);
  const [torchAvailable, setTorchAvailable] = useState(false);

  useEffect(() => {
    if (!active) return undefined;

    hasResultRef.current = false;
    busyRef.current = false;
    lastScanRef.current = 0;
    setStatus("starting");
    setTorchOn(false);

    let cancelled = false;
    let handoffTimer = null;

    const getLegacyGetUserMedia = () =>
      navigator.getUserMedia ||
      navigator.webkitGetUserMedia ||
      navigator.mozGetUserMedia ||
      navigator.msGetUserMedia;

    const getUserMediaCompat = (constraints) => {
      if (navigator.mediaDevices?.getUserMedia) return navigator.mediaDevices.getUserMedia(constraints);
      const legacy = getLegacyGetUserMedia();
      if (!legacy) return Promise.reject(new Error("Camera API unavailable"));
      return new Promise((resolve, reject) => legacy.call(navigator, constraints, resolve, reject));
    };

    function handleDetected(value) {
      const cleanValue = String(value || "").trim();
      if (!cleanValue || hasResultRef.current || cancelled) return;

      hasResultRef.current = true;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      setStatus("detected");

      handoffTimer = setTimeout(() => {
        if (!cancelled) onResultRef.current(cleanValue);
      }, DETECTED_FLASH_MS);
    }

    async function tickNative(timestamp) {
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
        // Keep scanning. Mobile cameras can occasionally reject a frame while
        // autofocus/exposure is changing.
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

      // QR path.
      const qrCtx = drawScaled(video, qrCanvasRef.current, QR_WIDTH);
      const qrData = qrCtx.getImageData(0, 0, qrCanvasRef.current.width, qrCanvasRef.current.height);
      const qr = jsQR(qrData.data, qrData.width, qrData.height, { inversionAttempts: "attemptBoth" });
      if (qr?.data) {
        handleDetected(qr.data);
        return;
      }

      // Code 128 path for the actual student ID cards used by this project.
      const barcodeCtx = drawScaled(video, barcodeCanvasRef.current, FALLBACK_WIDTH);
      const barcodeData = barcodeCtx.getImageData(
        0,
        0,
        barcodeCanvasRef.current.width,
        barcodeCanvasRef.current.height,
      );
      const code128 = decodeCode128(barcodeData, 9);
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
            width: { ideal: 1920 },
            height: { ideal: 1080 },
            frameRate: { ideal: 30, max: 60 },
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

        // Ask supported mobile browsers for continuous autofocus. Unsupported
        // constraints are harmlessly ignored.
        try {
          if (capabilities.focusMode?.includes?.("continuous")) {
            await track.applyConstraints({ advanced: [{ focusMode: "continuous" }] });
          }
        } catch {
          // Focus control is optional.
        }

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
            // Code 128 is the actual ID-card format. If the native browser
            // cannot decode Code 128, use our fallback for both QR + Code 128
            // instead of silently running a QR-only detector.
            if (formats.includes("code_128")) {
              detectorRef.current = new window.BarcodeDetector({ formats });
            }
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
      if (handoffTimer) clearTimeout(handoffTimer);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
      }
      detectorRef.current = null;
    };
  }, [active]);

  async function toggleTorch() {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;
    try {
      const next = !torchOn;
      await track.applyConstraints({ advanced: [{ torch: next }] });
      setTorchOn(next);
    } catch {
      // Torch is optional.
    }
  }

  if (!active) return null;

  return (
    <div style={wrap}>
      <div style={viewportFrame}>
        <video ref={videoRef} playsInline muted autoPlay style={videoStyle} />

        {status === "ready" && (
          <div style={reticle}>
            <span style={{ ...corner, top: 0, left: 0, borderRight: "none", borderBottom: "none" }} />
            <span style={{ ...corner, top: 0, right: 0, borderLeft: "none", borderBottom: "none" }} />
            <span style={{ ...corner, bottom: 0, left: 0, borderRight: "none", borderTop: "none" }} />
            <span style={{ ...corner, bottom: 0, right: 0, borderLeft: "none", borderTop: "none" }} />
            <div style={scanLine} />
          </div>
        )}

        {status === "detected" && (
          <div style={detectedOverlay}>
            <div style={detectedBadge}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
              <span>Card detected</span>
            </div>
          </div>
        )}

        {status === "starting" && <Overlay>Starting camera…</Overlay>}
        {status === "denied" && <Overlay>Camera access was blocked. Allow camera permission for this site, then reload — or use manual entry below.</Overlay>}
        {status === "insecure" && <Overlay>Camera access needs a secure (https://) page. Ask an admin to open this on https, or use manual entry below.</Overlay>}
        {status === "unsupported" && <Overlay>Camera scanning isn't supported on this browser or device. Please use manual entry below.</Overlay>}
      </div>

      {status === "ready" && <p style={hint}>Point the barcode on your ID card inside the frame</p>}
      {status === "detected" && <p style={{ ...hint, color: "var(--success)", fontWeight: 600 }}>Card detected — verifying…</p>}

      {torchAvailable && status === "ready" && (
        <button type="button" style={torchButton} onClick={toggleTorch}>
          {torchOn ? "Turn off flashlight" : "Turn on flashlight"}
        </button>
      )}
    </div>
  );
}

function Overlay({ children }) {
  return <div style={overlay}>{children}</div>;
}

const wrap = { display: "flex", flexDirection: "column", alignItems: "center", width: "100%" };
const viewportFrame = {
  position: "relative",
  width: "100%",
  maxWidth: 360,
  aspectRatio: "1.65 / 1",
  borderRadius: 16,
  overflow: "hidden",
  background: "#0b1220",
  margin: "8px auto 0",
};
const videoStyle = { width: "100%", height: "100%", objectFit: "cover" };
const overlay = {
  position: "absolute",
  inset: 0,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 20,
  textAlign: "center",
  color: "#e2e8f0",
  fontSize: 13.5,
  lineHeight: 1.5,
  background: "rgba(11,18,32,0.85)",
};
const reticle = { position: "absolute", inset: 18, pointerEvents: "none" };
const detectedOverlay = {
  position: "absolute",
  inset: 0,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  background: "rgba(15, 23, 42, 0.28)",
};
const detectedBadge = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  background: "var(--success)",
  color: "#fff",
  fontWeight: 700,
  fontSize: 14,
  padding: "10px 18px",
  borderRadius: 999,
  boxShadow: "0 4px 16px rgba(0,0,0,0.25)",
};
const corner = {
  position: "absolute",
  width: 28,
  height: 28,
  border: "3px solid var(--primary)",
  borderRadius: 4,
};
const scanLine = {
  position: "absolute",
  left: 0,
  right: 0,
  top: "50%",
  height: 2,
  background: "var(--primary)",
  opacity: 0.85,
  boxShadow: "0 0 8px var(--primary)",
};
const hint = { fontSize: 13.5, color: "var(--text-muted)", marginTop: 14, marginBottom: 0, textAlign: "center" };
const torchButton = {
  marginTop: 12,
  background: "transparent",
  border: "1px solid var(--border)",
  color: "var(--text)",
  borderRadius: 8,
  padding: "8px 16px",
  fontSize: 13,
};
