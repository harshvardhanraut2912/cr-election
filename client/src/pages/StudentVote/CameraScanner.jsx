import { useEffect, useRef, useState } from "react";
import jsQR from "jsqr";

// Android Chrome's native BarcodeDetector is the fastest path available to a
// normal web page. The important part for these college ID cards is CODE_128:
// the printed barcode in the supplied ID-card photo is a 1-D Code 128 barcode,
// not a QR code. We also keep QR support for cards that use QR.
const NATIVE_FORMATS = ["code_128", "qr_code"];
const DECODE_WIDTH = 640;
const FALLBACK_INTERVAL_MS = 90;
const DETECTED_FLASH_MS = 140;

export default function CameraScanner({ onResult, active }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const rafRef = useRef(null);
  const detectorRef = useRef(null);
  const cancelledRef = useRef(false);
  const foundRef = useRef(false);
  const busyRef = useRef(false);
  const lastScanRef = useRef(0);
  const onResultRef = useRef(onResult);
  const [status, setStatus] = useState("starting");
  const [torchOn, setTorchOn] = useState(false);
  const [torchAvailable, setTorchAvailable] = useState(false);

  useEffect(() => {
    onResultRef.current = onResult;
  }, [onResult]);

  useEffect(() => {
    if (!active) return undefined;

    cancelledRef.current = false;
    foundRef.current = false;
    busyRef.current = false;
    lastScanRef.current = 0;
    setStatus("starting");
    setTorchOn(false);
    setTorchAvailable(false);

    let timer = null;

    const getUserMedia = (constraints) => {
      if (navigator.mediaDevices?.getUserMedia) return navigator.mediaDevices.getUserMedia(constraints);
      const legacy = navigator.getUserMedia || navigator.webkitGetUserMedia || navigator.mozGetUserMedia || navigator.msGetUserMedia;
      if (!legacy) return Promise.reject(new Error("Camera API unavailable"));
      return new Promise((resolve, reject) => legacy.call(navigator, constraints, resolve, reject));
    };

    const stop = () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      if (timer) clearTimeout(timer);
      timer = null;
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
      }
    };

    const deliver = (value) => {
      if (cancelledRef.current || foundRef.current) return;
      const text = String(value || "").trim();
      if (!text) return;
      foundRef.current = true;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      setStatus("detected");
      timer = setTimeout(() => {
        if (!cancelledRef.current) onResultRef.current(text);
      }, DETECTED_FLASH_MS);
    };

    async function nativeLoop(timestamp) {
      if (cancelledRef.current || foundRef.current) return;
      rafRef.current = requestAnimationFrame(nativeLoop);
      if (busyRef.current || timestamp - lastScanRef.current < 35) return;

      const video = videoRef.current;
      const detector = detectorRef.current;
      if (!video || !detector || video.readyState < HTMLMediaElement.HAVE_ENOUGH_DATA) return;

      lastScanRef.current = timestamp;
      busyRef.current = true;
      try {
        const codes = await detector.detect(video);
        if (codes?.length) {
          const value = codes.find((c) => c.rawValue)?.rawValue;
          if (value) deliver(value);
        }
      } catch {
        // Ignore transient detector errors and keep scanning.
      } finally {
        busyRef.current = false;
      }
    }

    function fallbackLoop(timestamp) {
      if (cancelledRef.current || foundRef.current) return;
      rafRef.current = requestAnimationFrame(fallbackLoop);
      if (timestamp - lastScanRef.current < FALLBACK_INTERVAL_MS) return;

      const video = videoRef.current;
      if (!video || video.readyState < HTMLMediaElement.HAVE_ENOUGH_DATA || !video.videoWidth) return;
      lastScanRef.current = timestamp;

      // jsQR is only a QR fallback. Code 128 is handled by the native Android
      // detector above; keeping the fallback lightweight avoids making phones
      // hot/laggy while scanning.
      const scale = Math.min(1, DECODE_WIDTH / video.videoWidth);
      const width = Math.max(1, Math.round(video.videoWidth * scale));
      const height = Math.max(1, Math.round(video.videoHeight * scale));
      const canvas = canvasRef.current || document.createElement("canvas");
      canvasRef.current = canvas;
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) return;
      ctx.drawImage(video, 0, 0, width, height);
      const image = ctx.getImageData(0, 0, width, height);
      const code = jsQR(image.data, image.width, image.height, { inversionAttempts: "attemptBoth" });
      if (code?.data) deliver(code.data);
    }

    async function start() {
      if (!window.isSecureContext && location.hostname !== "localhost") {
        setStatus("insecure");
        return;
      }

      if (!navigator.mediaDevices?.getUserMedia && !navigator.getUserMedia && !navigator.webkitGetUserMedia) {
        setStatus("unsupported");
        return;
      }

      try {
        const stream = await getUserMedia({
          video: {
            facingMode: { ideal: "environment" },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
          audio: false,
        });

        if (cancelledRef.current) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        streamRef.current = stream;
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        await video.play();

        const track = stream.getVideoTracks()[0];
        const caps = track?.getCapabilities?.();
        setTorchAvailable(Boolean(caps?.torch));

        // BarcodeDetector is supported on current Chromium Android builds and
        // reads Code 128 directly from the video, which is much faster than a
        // JavaScript canvas decoder.
        if (typeof window.BarcodeDetector === "function") {
          try {
            let supported = true;
            if (typeof window.BarcodeDetector.getSupportedFormats === "function") {
              const formats = await window.BarcodeDetector.getSupportedFormats();
              supported = NATIVE_FORMATS.some((format) => formats.includes(format));
            }
            if (supported) {
              try {
                detectorRef.current = new window.BarcodeDetector({ formats: NATIVE_FORMATS });
              } catch {
                // Some implementations reject one format even when the API
                // exists. A detector without an explicit list still works on
                // those implementations.
                detectorRef.current = new window.BarcodeDetector();
              }
            }
          } catch {
            detectorRef.current = null;
          }
        }

        setStatus("ready");
        rafRef.current = requestAnimationFrame(detectorRef.current ? nativeLoop : fallbackLoop);
      } catch (err) {
        console.error("Camera scanner error:", err);
        setStatus(err?.name === "NotAllowedError" ? "denied" : "denied");
      }
    }

    start();
    return () => {
      cancelledRef.current = true;
      stop();
      detectorRef.current = null;
    };
  }, [active]);

  async function toggleTorch() {
    const track = streamRef.current?.getVideoTracks?.()[0];
    if (!track) return;
    try {
      const next = !torchOn;
      await track.applyConstraints({ advanced: [{ torch: next }] });
      setTorchOn(next);
    } catch {
      // Torch isn't available on every browser/device.
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

        {status === "starting" && <Overlay>Starting camera…</Overlay>}
        {status === "denied" && <Overlay>Camera access was blocked. Allow camera permission for this site, then reload.</Overlay>}
        {status === "insecure" && <Overlay>Camera access needs a secure HTTPS page.</Overlay>}
        {status === "unsupported" && <Overlay>Camera scanning is not supported on this browser. Use manual entry below.</Overlay>}
        {status === "detected" && (
          <div style={detectedOverlay}>
            <div style={detectedBadge}>✓ Card detected</div>
          </div>
        )}
      </div>

      {status === "ready" && <p style={hint}>Align the barcode on your ID card inside the frame</p>}
      {status === "detected" && <p style={{ ...hint, color: "var(--success)", fontWeight: 700 }}>Card detected — looking up student…</p>}

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
const viewportFrame = { position: "relative", width: "100%", maxWidth: 340, aspectRatio: "4 / 3", borderRadius: 16, overflow: "hidden", background: "#0b1220", margin: "12px auto 0" };
const videoStyle = { width: "100%", height: "100%", objectFit: "cover" };
const overlay = { position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", padding: 20, textAlign: "center", color: "#e2e8f0", fontSize: 13.5, lineHeight: 1.5, background: "rgba(11,18,32,0.82)" };
const reticle = { position: "absolute", left: "10%", right: "10%", top: "28%", bottom: "28%", pointerEvents: "none" };
const detectedOverlay = { position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(15,23,42,0.28)" };
const detectedBadge = { display: "flex", alignItems: "center", gap: 8, background: "var(--success)", color: "#fff", fontWeight: 700, fontSize: 14, padding: "10px 18px", borderRadius: 999, boxShadow: "0 4px 16px rgba(0,0,0,0.25)" };
const corner = { position: "absolute", width: 28, height: 28, border: "3px solid var(--primary)", borderRadius: 4 };
const scanLine = { position: "absolute", left: 0, right: 0, top: "50%", height: 2, background: "var(--primary)", opacity: 0.85, boxShadow: "0 0 8px var(--primary)" };
const hint = { fontSize: 13.5, color: "var(--text-muted)", marginTop: 14, marginBottom: 0, textAlign: "center" };
const torchButton = { marginTop: 12, background: "transparent", border: "1px solid var(--border)", color: "var(--text)", borderRadius: 8, padding: "8px 16px", fontSize: 13 };
