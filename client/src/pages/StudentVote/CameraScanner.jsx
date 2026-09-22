import { useEffect, useRef, useState } from "react";
import jsQR from "jsqr";

/**
 * Live camera QR scanner. Opens the device camera (rear camera preferred)
 * and scans incoming frames for a QR code, calling onResult(text) once a
 * code is decoded.
 *
 * Two decode paths:
 *  - Native `BarcodeDetector` (Chrome/Edge on Android, and desktop Chrome
 *    behind a flag): this is the SAME underlying engine Android's system
 *    QR scanner and Google Lens use — hardware/GPU-backed, not JS decoding
 *    a bitmap. It reads the <video> element directly every frame with
 *    effectively zero lag. We use this whenever it's available.
 *  - jsQR fallback for browsers that don't expose BarcodeDetector yet
 *    (Safari/iOS, Firefox). Still downscaled + throttled for speed.
 */
const HAS_NATIVE_DETECTOR = typeof window !== "undefined" && "BarcodeDetector" in window;

// jsQR fallback tuning — decoding is done on a downscaled copy of the video
// frame, not the raw camera resolution. jsQR's cost scales with pixel
// count, so scanning a full 1920x1080 frame (~2M px) instead of a
// ~480px-wide copy (~80K px) is over 20x slower for no accuracy benefit.
const DECODE_WIDTH = 480;
// How often we attempt a decode. Native detector can run every animation
// frame (it's fast enough); jsQR is throttled to stay light on the device.
const NATIVE_SCAN_INTERVAL_MS = 0;
const FALLBACK_SCAN_INTERVAL_MS = 80;

// How long the "QR Detected" confirmation flashes before we hand off —
// matches the brief green-checkmark flash you see in Google Lens / Android's
// scanner before it acts on the code. Long enough to register, short enough
// to still feel instant.
const DETECTED_FLASH_MS = 260;

export default function CameraScanner({ onResult, active }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(document.createElement("canvas"));
  const streamRef = useRef(null);
  const rafRef = useRef(null);
  const hasResultRef = useRef(false);
  const lastScanRef = useRef(0);
  const detectorRef = useRef(null);
  const busyRef = useRef(false); // guards overlapping async native detect() calls

  const [status, setStatus] = useState("starting"); // starting | ready | detected | denied | unsupported | insecure
  const [torchOn, setTorchOn] = useState(false);
  const [torchAvailable, setTorchAvailable] = useState(false);

  // Some older/in-app browsers (e.g. some WebViews) only expose the legacy,
  // vendor-prefixed getUserMedia instead of navigator.mediaDevices.getUserMedia.
  // Polyfill it so we don't wrongly report "unsupported" on those devices.
  function getLegacyGetUserMedia() {
    return (
      navigator.getUserMedia ||
      navigator.webkitGetUserMedia ||
      navigator.mozGetUserMedia ||
      navigator.msGetUserMedia
    );
  }

  function getUserMediaCompat(constraints) {
    if (navigator.mediaDevices?.getUserMedia) {
      return navigator.mediaDevices.getUserMedia(constraints);
    }
    const legacy = getLegacyGetUserMedia();
    return new Promise((resolve, reject) => legacy.call(navigator, constraints, resolve, reject));
  }

  useEffect(() => {
    if (!active) return;
    hasResultRef.current = false;
    busyRef.current = false;
    lastScanRef.current = 0;
    setStatus("starting");
    let cancelled = false;

    async function start() {
      // getUserMedia is only exposed in a "secure context": https://, or
      // http://localhost. On plain http:// (e.g. a LAN IP on college wifi)
      // the browser hides the API entirely, which used to be misreported as
      // "not supported". Surface the real reason instead.
      if (!window.isSecureContext && location.hostname !== "localhost") {
        setStatus("insecure");
        return;
      }
      if (!navigator.mediaDevices?.getUserMedia && !getLegacyGetUserMedia()) {
        setStatus("unsupported");
        return;
      }
      try {
        // Ask the camera itself for a moderate resolution. Requesting the
        // sensor's max (often 4K on modern phones) means every frame has
        // to be captured, transferred and JS-decoded at that size before
        // we even get a chance to downscale it — slower to start and
        // slower per frame. 1280x720 is plenty to read a QR code.
        const stream = await getUserMediaCompat({
          video: {
            facingMode: { ideal: "environment" },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
        const track = stream.getVideoTracks()[0];
        const caps = track.getCapabilities?.();
        setTorchAvailable(!!caps?.torch);

        if (HAS_NATIVE_DETECTOR) {
          try {
            detectorRef.current = new window.BarcodeDetector({ formats: ["qr_code"] });
          } catch {
            detectorRef.current = null; // formats not supported — fall through to jsQR
          }
        }

        setStatus("ready");
        rafRef.current = requestAnimationFrame(detectorRef.current ? tickNative : tickFallback);
      } catch (err) {
        setStatus("denied");
      }
    }

    // A code was found: flash "QR Detected" briefly (like the checkmark
    // flash in Google Lens / Android's scanner) then hand off the value.
    function handleDetected(value) {
      hasResultRef.current = true;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      setStatus("detected");
      setTimeout(() => {
        if (!cancelled) onResult(value);
      }, DETECTED_FLASH_MS);
    }

    // --- Native BarcodeDetector path: reads the <video> element directly,
    // no canvas/getImageData round-trip, GPU-accelerated on supporting
    // devices. This is what makes it feel as instant as a phone's built-in
    // scanner. `detect()` is async, so we guard against overlapping calls
    // piling up if a frame takes longer than expected.
    async function tickNative(timestamp) {
      if (cancelled || hasResultRef.current) return;
      rafRef.current = requestAnimationFrame(tickNative);
      if (busyRef.current) return;
      if (timestamp - lastScanRef.current < NATIVE_SCAN_INTERVAL_MS) return;

      const video = videoRef.current;
      if (!video || video.readyState !== video.HAVE_ENOUGH_DATA) return;
      lastScanRef.current = timestamp;
      busyRef.current = true;
      try {
        const codes = await detectorRef.current.detect(video);
        if (!cancelled && !hasResultRef.current && codes && codes.length > 0 && codes[0].rawValue) {
          handleDetected(codes[0].rawValue);
        }
      } catch {
        // A transient decode error on one frame — just try again next frame.
      } finally {
        busyRef.current = false;
      }
    }

    // --- jsQR fallback path (Safari/iOS, Firefox, or any browser without
    // BarcodeDetector support for qr_code).
    function tickFallback(timestamp) {
      if (cancelled || hasResultRef.current) return;
      rafRef.current = requestAnimationFrame(tickFallback);

      // Throttle: skip this frame unless enough time has passed since the
      // last decode attempt. Keeps CPU usage (and therefore lag) low
      // without any visible delay to the person scanning.
      if (timestamp - lastScanRef.current < FALLBACK_SCAN_INTERVAL_MS) return;

      const video = videoRef.current;
      if (!video || video.readyState !== video.HAVE_ENOUGH_DATA || !video.videoWidth) return;
      lastScanRef.current = timestamp;

      // Downscale the frame before decoding — this is the main speedup.
      const scale = Math.min(1, DECODE_WIDTH / video.videoWidth);
      const w = Math.round(video.videoWidth * scale);
      const h = Math.round(video.videoHeight * scale);

      const canvas = canvasRef.current;
      if (canvas.width !== w) canvas.width = w;
      if (canvas.height !== h) canvas.height = h;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      ctx.drawImage(video, 0, 0, w, h);
      const imageData = ctx.getImageData(0, 0, w, h);
      // "attemptBoth" also tries an inverted read (light-on-dark codes,
      // glare, printed ID cards) at a small extra cost that the downscale
      // more than pays for — worth it for reliability on real ID cards.
      const code = jsQR(imageData.data, imageData.width, imageData.height, {
        inversionAttempts: "attemptBoth",
      });
      if (code && code.data) {
        handleDetected(code.data);
      }
    }

    start();

    return () => {
      cancelled = true;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  async function toggleTorch() {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;
    try {
      const next = !torchOn;
      await track.applyConstraints({ advanced: [{ torch: next }] });
      setTorchOn(next);
    } catch {
      // Torch control not supported on this device/browser — ignore.
    }
  }

  if (!active) return null;

  return (
    <div style={wrap}>
      <div style={viewportFrame}>
        <video ref={videoRef} playsInline muted style={videoStyle} />
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
              <span>QR Detected</span>
            </div>
          </div>
        )}
        {status === "starting" && <Overlay>Starting camera…</Overlay>}
        {status === "denied" && (
          <Overlay>
            Camera access was blocked. Allow camera permission for this site, then reload — or use manual entry
            below.
          </Overlay>
        )}
        {status === "insecure" && (
          <Overlay>
            Camera access needs a secure (https://) page. Ask an admin to open this on https, or use manual entry
            below.
          </Overlay>
        )}
        {status === "unsupported" && <Overlay>Camera scanning isn't supported on this browser or device. Please use manual entry below.</Overlay>}
      </div>

      {status === "ready" && (
        <p style={hint}>Point the camera at the QR code on your ID card</p>
      )}
      {status === "detected" && (
        <p style={{ ...hint, color: "var(--success)", fontWeight: 600 }}>QR code detected — verifying…</p>
      )}

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
  maxWidth: 320,
  aspectRatio: "1 / 1",
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

const reticle = { position: "absolute", inset: 24, pointerEvents: "none" };

const detectedOverlay = {
  position: "absolute",
  inset: 0,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  background: "rgba(15, 23, 42, 0.35)",
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
  width: 26,
  height: 26,
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
