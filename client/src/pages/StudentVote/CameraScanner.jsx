import { useEffect, useRef, useState } from "react";
import jsQR from "jsqr";

/**
 * Live camera QR scanner. Opens the device camera (rear camera preferred),
 * continuously scans incoming frames for a QR code using jsQR, and calls
 * onResult(text) exactly once as soon as a code is decoded.
 */
// Decoding is done on a downscaled copy of the video frame, not the raw
// camera resolution. jsQR's cost scales with pixel count, so scanning a
// full 1920x1080 frame (~2M px) instead of a ~480px-wide copy (~80K px)
// is over 20x slower for no accuracy benefit — that's what made the old
// version feel stuck/slow on phones.
const DECODE_WIDTH = 480;
// Cap scan attempts instead of running one every animation frame (up to
// 60/sec). 12/sec is still instant-feeling to a human and leaves the
// device far less loaded, which also helps camera autofocus keep up.
const SCAN_INTERVAL_MS = 80;

export default function CameraScanner({ onResult, active }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(document.createElement("canvas"));
  const streamRef = useRef(null);
  const rafRef = useRef(null);
  const hasResultRef = useRef(false);
  const lastScanRef = useRef(0);

  const [status, setStatus] = useState("starting"); // starting | ready | denied | unsupported | insecure
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
        setStatus("ready");
        tick();
      } catch (err) {
        setStatus("denied");
      }
    }

    function tick(timestamp) {
      if (cancelled || hasResultRef.current) return;
      rafRef.current = requestAnimationFrame(tick);

      // Throttle: skip this frame unless enough time has passed since the
      // last decode attempt. Keeps CPU usage (and therefore lag) low
      // without any visible delay to the person scanning.
      if (timestamp - lastScanRef.current < SCAN_INTERVAL_MS) return;

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
        hasResultRef.current = true;
        if (rafRef.current) cancelAnimationFrame(rafRef.current);
        onResult(code.data);
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
