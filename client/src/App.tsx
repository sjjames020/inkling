import { useRef, useState } from "react";
import "./App.css";

type Mode = "home" | "camera" | "processing" | "result";

export default function App() {
  const [mode, setMode] = useState<Mode>("home");
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const handleOCR = async (file: File) => {
    setMode("processing");
    setError(null);
    setResult(null);

    try {
      const formData = new FormData();
      formData.append("image", file);

      const response = await fetch("/api/ocr", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        throw new Error(`Server error: ${response.statusText}`);
      }

      const data = await response.json();
      setResult(typeof data.text === "string" ? data.text.trim() : "");
      setMode("result");
    } catch (err) {
      setError(err instanceof Error ? err.message : "OCR failed");
      setMode("result");
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      setPreview(event.target?.result as string);
    };
    reader.readAsDataURL(file);

    handleOCR(file);
  };

  const startCamera = async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
      });
      streamRef.current = stream;
      setMode("camera");
      // Wait for video element to mount
      setTimeout(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
      }, 50);
    } catch {
      setError("Camera access denied or unavailable");
    }
  };

  const stopCamera = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  };

  const capturePhoto = () => {
    if (!videoRef.current || !canvasRef.current) return;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d")?.drawImage(video, 0, 0);
    setPreview(canvas.toDataURL("image/jpeg"));
    stopCamera();
    canvas.toBlob(
      (blob) => {
        if (blob) {
          handleOCR(new File([blob], "capture.jpg", { type: "image/jpeg" }));
        }
      },
      "image/jpeg",
      0.9,
    );
  };

  const handleReset = () => {
    stopCamera();
    setMode("home");
    setResult(null);
    setError(null);
    setPreview(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleCopy = () => {
    if (result) navigator.clipboard.writeText(result);
  };

  // ── Camera viewfinder (full-screen) ──────────────────────────────────────
  if (mode === "camera") {
    return (
      <div className="camera-view">
        <video
          ref={videoRef}
          className="camera-feed"
          autoPlay
          playsInline
          muted
        />
        <canvas ref={canvasRef} className="hidden-canvas" />
        <div className="scan-overlay">
          <div className="scan-frame">
            <span className="corner tl" />
            <span className="corner tr" />
            <span className="corner bl" />
            <span className="corner br" />
          </div>
          <p className="scan-hint">Align your notes within the frame</p>
        </div>
        <div className="camera-bar">
          <button type="button" className="camera-cancel" onClick={handleReset} title="Cancel">
            ✕
          </button>
          <button type="button" className="shutter-btn" onClick={capturePhoto} title="Capture" />
          <div className="camera-bar-spacer" />
        </div>
      </div>
    );
  }

  // ── Main app shell ────────────────────────────────────────────────────────
  return (
    <div className="app-container">
      <header className="header">
        <h1 className="title">Inkling</h1>
        <p className="subtitle">Handwritten notes → clean text</p>
      </header>

      <main className="main-content">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={handleFileSelect}
          className="file-input"
          id="fileInput"
        />

        {/* Home — choose upload or scan */}
        {mode === "home" && (
          <div className="home-actions">
            <label htmlFor="fileInput" className="action-card upload-card">
              <span className="action-icon">📄</span>
              <span className="action-label">Upload</span>
              <span className="action-sub">From your gallery</span>
            </label>
            <button type="button" className="action-card scan-card" onClick={startCamera}>
              <span className="action-icon">📷</span>
              <span className="action-label">Scan</span>
              <span className="action-sub">Use your camera</span>
            </button>
          </div>
        )}

        {/* Processing */}
        {mode === "processing" && (
          <div className="processing-view">
            {preview && (
              <img src={preview} alt="Captured" className="processing-thumb" />
            )}
            <div className="spinner-ring" />
            <p className="processing-text">Reading your notes…</p>
          </div>
        )}

        {/* Result */}
        {mode === "result" && (
          <div className="result-view">
            {error ? (
              <div className="error-box">
                <p>⚠️ {error}</p>
                <button type="button" className="btn-ghost" onClick={handleReset}>
                  Try again
                </button>
              </div>
            ) : (
              <>
                <textarea
                  value={result ?? ""}
                  onChange={(e) => setResult(e.target.value)}
                  className="result-textarea"
                  spellCheck={false}
                  aria-label="OCR result text"
                />
                <div className="result-actions">
                  <button type="button" className="btn-primary" onClick={handleCopy}>
                    Copy text
                  </button>
                  <button type="button" className="btn-ghost" onClick={handleReset}>
                    Scan again
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
