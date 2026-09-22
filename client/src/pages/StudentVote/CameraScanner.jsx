import { useEffect, useRef, useState } from "react";
import jsQR from "jsqr";

/**
 * Live camera QR scanner. Opens the device camera (rear camera preferred),
 * continuously scans incoming frames for a QR code using jsQR, and calls
 * onResult(text) exactly once as soon as a code is decoded.
 */
export default function CameraScanner({ onResult, active }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(document.createElement("canvas"));
  const streamRef = useRef(null);
  const rafRef = useRef(null);
  const hasResultRef = useRef(false);

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
        const stream = await getUserMediaCompat({
          video: { facingMode: { ideal: "environment" } },
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

    function tick() {
      if (cancelled || hasResultRef.current) return;
      const video = videoRef.current;
      if (video && video.readyState === video.HAVE_ENOUGH_DATA) {
        const canvas = canvasRef.current;
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const code = jsQR(imageData.data, imageData.width, imageData.height, {
          inversionAttempts: "dontInvert",
        });
        if (code && code.data) {
          hasResultRef.current = true;
          onResult(code.data);
          return;
        }
      }
      rafRef.current = requestAnimationFrame(tick);
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
