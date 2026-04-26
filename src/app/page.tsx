'use client';

import { useEffect, useRef, useState, useCallback } from 'react';

interface TranslationItem {
  original: string;
  translation: string;
  context?: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

function resizeToB64(src: HTMLCanvasElement, maxW: number, quality: number): string {
  let w = src.width, h = src.height;
  if (w > maxW) { h = Math.round(h * maxW / w); w = maxW; }
  const tmp = document.createElement('canvas');
  tmp.width = w; tmp.height = h;
  tmp.getContext('2d')!.drawImage(src, 0, 0, w, h);
  return tmp.toDataURL('image/jpeg', quality).split(',')[1];
}

function drawFittedText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number, y: number, w: number, h: number
) {
  const pad = 4;
  const availW = w - pad * 2;

  let fontSize = Math.min(10, Math.max(7, h * 0.55));

  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  while (fontSize > 6) {
    ctx.font = `600 ${fontSize}px "Be Vietnam Pro", system-ui, sans-serif`;
    if (ctx.measureText(text).width <= availW) break;
    fontSize -= 0.5;
  }

  let display = text;
  ctx.font = `600 ${fontSize}px "Be Vietnam Pro", system-ui, sans-serif`;
  if (ctx.measureText(display).width > availW) {
    while (ctx.measureText(display + '…').width > availW && display.length > 1) {
      display = display.slice(0, -1);
    }
    display += '…';
  }

  ctx.fillStyle = '#ffffff';
  ctx.fillText(display, x + pad, y + h / 2);
}

export default function TranslateVN() {
  const videoRef       = useRef<HTMLVideoElement>(null);
  const arRef          = useRef<HTMLCanvasElement>(null);
  const flashRef       = useRef<HTMLDivElement>(null);
  const snapshotRef    = useRef<HTMLCanvasElement | null>(null);
  const streamRef      = useRef<MediaStream | null>(null);
  const zoomRef        = useRef({ scale: 1, panX: 0, panY: 0, lastDist: 0, isPinch: false, sx: 0, sy: 0 });
  const fileInputRef   = useRef<HTMLInputElement>(null);

  const [scanning, setScanning] = useState(false);
  const [arActive, setArActive] = useState(false);
  const [noCamera, setNoCamera] = useState(false);

  const scanRef = useRef(false); scanRef.current = scanning;
  const arRef2  = useRef(false); arRef2.current  = arActive;

  const gold = '#c8922a';

  // ── Pinch/pan transform ────────────────────────────────────────────────────
  const applyTransform = useCallback(() => {
    const canvas = arRef.current;
    if (!canvas) return;
    const { scale, panX, panY } = zoomRef.current;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const maxPanX = (vw * (scale - 1)) / 2;
    const maxPanY = (vh * (scale - 1)) / 2;
    zoomRef.current.panX = Math.min(maxPanX, Math.max(-maxPanX, panX));
    zoomRef.current.panY = Math.min(maxPanY, Math.max(-maxPanY, panY));
    canvas.style.transform = `translate(${zoomRef.current.panX}px, ${zoomRef.current.panY}px) scale(${scale})`;
    canvas.style.transformOrigin = 'center center';
  }, []);

  // ── Camera ─────────────────────────────────────────────────────────────────
  const startCamera = useCallback(async () => {
    setNoCamera(false);
    try {
      streamRef.current?.getTracks().forEach(t => t.stop());
      const s = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      streamRef.current = s;
      const v = videoRef.current;
      if (v) { v.srcObject = s; await v.play(); }
    } catch { setNoCamera(true); }
  }, []);

  useEffect(() => {
    startCamera();
    return () => { streamRef.current?.getTracks().forEach(t => t.stop()); };
  }, [startCamera]);

  const resumeCamera = useCallback(() => {
    const canvas = arRef.current;
    if (canvas) {
      canvas.style.display = 'none';
      canvas.style.transform = '';
    }
    zoomRef.current = { scale: 1, panX: 0, panY: 0, lastDist: 0, isPinch: false, sx: 0, sy: 0 };
    snapshotRef.current = null;
    setArActive(false);
  }, []);

  // ── AR Renderer ────────────────────────────────────────────────────────────
  const renderAR = useCallback((items: TranslationItem[], errMsg: string | null) => {
    const snap   = snapshotRef.current;
    const canvas = arRef.current;
    if (!snap || !canvas) return;

    const vw = window.innerWidth;
    const vh = window.innerHeight;
    canvas.width  = vw;
    canvas.height = vh;
    const ctx = canvas.getContext('2d')!;

    // object-fit:cover math
    const scale = Math.max(vw / snap.width, vh / snap.height);
    const drawW = snap.width  * scale;
    const drawH = snap.height * scale;
    const offX  = (vw - drawW) / 2;
    const offY  = (vh - drawH) / 2;
    ctx.drawImage(snap, offX, offY, drawW, drawH);

    items.forEach(item => {
      const full = (item.translation || '').trim();
      if (!full) return;

      // Map % coords to canvas pixels
      const bx = offX + (item.x / 100) * drawW;
      const by = offY + (item.y / 100) * drawH;
      const bw = (item.w / 100) * drawW;
      const bh = (item.h / 100) * drawH;

      // Clamp box to stay within canvas bounds
      const cx = Math.max(0, Math.min(bx, vw - 10));
      const cy = Math.max(0, Math.min(by, vh - 10));
      const cw = Math.min(bw, vw - cx);

      // Shrink height to just wrap one text line
      const textH = Math.min(bh, Math.max(14, bh * 0.45));
      const textY = cy + (bh - textH) / 2;

      // Keep box on screen vertically
      const finalY = Math.max(0, Math.min(textY, vh - textH - 2));

      ctx.fillStyle = 'rgba(0,0,0,0.85)';
      ctx.fillRect(cx, finalY, cw, textH);

      ctx.fillStyle = gold;
      ctx.fillRect(cx, finalY, 2, textH);

      drawFittedText(ctx, full, cx + 2, finalY, cw - 2, textH);
    });

    if (errMsg || items.length === 0) {
      const msg = errMsg ?? 'No Vietnamese text found';
      ctx.save();
      ctx.fillStyle = 'rgba(0,0,0,0.7)';
      ctx.beginPath();
      ctx.roundRect(vw / 2 - 160, vh / 2 - 28, 320, 56, 14);
      ctx.fill();
      ctx.fillStyle = errMsg ? '#f85149' : 'rgba(255,255,255,0.5)';
      ctx.font = '500 14px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(msg, vw / 2, vh / 2);
      ctx.restore();
    }

    zoomRef.current = { scale: 1, panX: 0, panY: 0, lastDist: 0, isPinch: false, sx: 0, sy: 0 };
    canvas.style.transform = '';
    canvas.style.display = 'block';
    setArActive(true);
  }, []);

  // ── Translate ──────────────────────────────────────────────────────────────
  const translate = useCallback(async (b64: string) => {
    setScanning(true);
    try {
      const res  = await fetch('/api/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageBase64: b64, imageMime: 'image/jpeg', mode: 'full' }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      renderAR(data.items ?? [], null);
    } catch (err) {
      renderAR([], err instanceof Error ? err.message : 'Error');
    }
    setScanning(false);
  }, [renderAR]);

  // ── Capture from camera ────────────────────────────────────────────────────
  const capture = useCallback(() => {
    if (scanRef.current || !videoRef.current) return;
    if (flashRef.current) {
      flashRef.current.style.opacity = '0.7';
      setTimeout(() => { if (flashRef.current) flashRef.current.style.opacity = '0'; }, 140);
    }
    const snap = document.createElement('canvas');
    snap.width  = videoRef.current.videoWidth  || 1280;
    snap.height = videoRef.current.videoHeight || 720;
    snap.getContext('2d')!.drawImage(videoRef.current, 0, 0, snap.width, snap.height);
    snapshotRef.current = snap;
    translate(resizeToB64(snap, 1200, 0.85));
  }, [translate]);

  // ── Gallery upload ─────────────────────────────────────────────────────────
  const handleGallery = useCallback((file?: File | null) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = e => {
      const img = new Image();
      img.onload = () => {
        const tmp = document.createElement('canvas');
        tmp.width  = img.naturalWidth;
        tmp.height = img.naturalHeight;
        tmp.getContext('2d')!.drawImage(img, 0, 0, tmp.width, tmp.height);
        snapshotRef.current = tmp;
        translate(resizeToB64(tmp, 1200, 0.85));
      };
      img.src = e.target!.result as string;
    };
    reader.readAsDataURL(file);
  }, [translate]);

  // ── Touch: pinch-zoom + pan ────────────────────────────────────────────────
  const handleTouchStart = useCallback((e: React.TouchEvent<HTMLCanvasElement>) => {
    if (e.touches.length === 1) {
      zoomRef.current.sx = e.touches[0].clientX;
      zoomRef.current.sy = e.touches[0].clientY;
      zoomRef.current.isPinch = false;
    } else if (e.touches.length === 2) {
      zoomRef.current.isPinch = true;
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      zoomRef.current.lastDist = Math.hypot(dx, dy);
    }
  }, []);

  const handleTouchMove = useCallback((e: React.TouchEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    if (e.touches.length === 2) {
      zoomRef.current.isPinch = true;
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const dist  = Math.hypot(dx, dy);
      const delta = dist / zoomRef.current.lastDist;
      zoomRef.current.scale = Math.min(8, Math.max(1, zoomRef.current.scale * delta));
      zoomRef.current.lastDist = dist;
      applyTransform();
    } else if (e.touches.length === 1 && !zoomRef.current.isPinch) {
      if (zoomRef.current.scale <= 1.01) return;
      zoomRef.current.panX += e.touches[0].clientX - zoomRef.current.sx;
      zoomRef.current.panY += e.touches[0].clientY - zoomRef.current.sy;
      zoomRef.current.sx = e.touches[0].clientX;
      zoomRef.current.sy = e.touches[0].clientY;
      applyTransform();
    }
  }, [applyTransform]);

  const handleTouchEnd = useCallback((e: React.TouchEvent<HTMLCanvasElement>) => {
    if (e.touches.length === 0) {
      if (!zoomRef.current.isPinch && e.changedTouches.length === 1) {
        const t  = e.changedTouches[0];
        const dx = Math.abs(t.clientX - zoomRef.current.sx);
        const dy = Math.abs(t.clientY - zoomRef.current.sy);
        if (dx < 12 && dy < 12 && zoomRef.current.scale <= 1.05) resumeCamera();
      }
      zoomRef.current.isPinch = false;
    }
  }, [resumeCamera]);

  const onShutter = useCallback(() => {
    if (arActive) { resumeCamera(); return; }
    capture();
  }, [arActive, capture, resumeCamera]);

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#000' }}>

      {/* Live video */}
      <video
        ref={videoRef}
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', zIndex: 1 }}
        autoPlay playsInline muted
        onClick={() => { if (!scanning && !arActive) capture(); }}
      />

      {/* AR canvas */}
      <canvas
        ref={arRef}
        style={{
          position: 'absolute', inset: 0, width: '100%', height: '100%',
          zIndex: 2, cursor: 'pointer', display: 'none',
          touchAction: 'none', willChange: 'transform',
        }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onClick={() => { if (arActive && zoomRef.current.scale <= 1.05) resumeCamera(); }}
      />

      {/* Flash */}
      <div ref={flashRef} style={{ position: 'absolute', inset: 0, zIndex: 25, background: 'white', opacity: 0, pointerEvents: 'none', transition: 'opacity .12s' }} />

      {/* Top bar — always visible */}
      <div style={{
        position: 'fixed', top: 0, left: 0, right: 0, zIndex: 30,
        padding: 'max(env(safe-area-inset-top),14px) 20px 14px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        background: 'linear-gradient(to bottom,rgba(0,0,0,0.8),transparent)',
        pointerEvents: 'none',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, pointerEvents: 'auto' }}>
          <div style={{ width: 34, height: 34, borderRadius: 10, background: 'linear-gradient(135deg,#c8922a,#8b5e10)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16 }}>🇻🇳</div>
          <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1 }}>
            <span style={{ fontFamily: "'Playfair Display',serif", fontSize: 15, color: '#fff' }}>Translate</span>
            <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.18em', textTransform: 'uppercase', color: gold, marginTop: 2 }}>Vietnamese</span>
          </div>
        </div>

        {/* AR hint badge */}
        {arActive && (
          <div style={{ pointerEvents: 'auto', background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(10px)', border: '1px solid rgba(200,146,42,0.3)', borderRadius: 20, padding: '6px 14px', fontSize: 11, color: 'rgba(255,255,255,0.6)', display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ color: '#e8b84b', fontWeight: 700 }}>EN</span> Pinch to zoom · Tap to dismiss
          </div>
        )}
      </div>

      {/* Viewfinder */}
      {!arActive && (
        <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-58%)', width: '70vw', maxWidth: 280, aspectRatio: '1', zIndex: 8, pointerEvents: 'none', opacity: 0.6 }}>
          {(['tl', 'tr', 'bl', 'br'] as const).map(pos => {
            const map: Record<string, React.CSSProperties> = {
              tl: { top: 0, left: 0, borderWidth: '2px 0 0 2px', borderRadius: '3px 0 0 0' },
              tr: { top: 0, right: 0, borderWidth: '2px 2px 0 0', borderRadius: '0 3px 0 0' },
              bl: { bottom: 0, left: 0, borderWidth: '0 0 2px 2px', borderRadius: '0 0 0 3px' },
              br: { bottom: 0, right: 0, borderWidth: '0 2px 2px 0', borderRadius: '0 0 3px 0' },
            };
            return <div key={pos} style={{ position: 'absolute', width: 22, height: 22, borderColor: '#e8b84b', borderStyle: 'solid', ...map[pos] }} />;
          })}
        </div>
      )}

      {/* Bottom bar — FIXED so it stays visible even when zoomed */}
      <div style={{
        position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 30,
        padding: '16px 40px max(env(safe-area-inset-bottom),20px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 36,
        background: 'linear-gradient(to top,rgba(0,0,0,0.85),transparent)',
      }}>

        {/* Gallery button */}
        <label style={{
          width: 52, height: 52, borderRadius: '50%',
          border: '1px solid rgba(255,255,255,0.2)',
          background: 'rgba(0,0,0,0.5)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 22, cursor: 'pointer', flexShrink: 0,
          backdropFilter: 'blur(10px)',
        }}>
          🖼️
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            onChange={e => {
              const file = e.target.files?.[0];
              if (file) handleGallery(file);
              // Reset so same file can be picked again
              e.target.value = '';
            }}
          />
        </label>

        {/* Shutter / dismiss button */}
        <div
          onClick={onShutter}
          style={{
            width: 76, height: 76, borderRadius: '50%',
            border: `2px solid ${scanning ? '#e8b84b' : gold}`,
            background: 'rgba(0,0,0,0.45)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer', flexShrink: 0,
            backdropFilter: 'blur(8px)',
            boxShadow: scanning
              ? '0 0 30px rgba(232,184,75,0.5)'
              : '0 0 20px rgba(200,146,42,0.3)',
            transition: 'box-shadow .2s, border-color .2s',
          }}
        >
          <span style={{ fontSize: 26 }}>
            {arActive ? '✕' : scanning ? '⏳' : '📷'}
          </span>
        </div>

        {/* Spacer to balance layout */}
        <div style={{ width: 52, height: 52, flexShrink: 0 }} />
      </div>

      {/* Scanning badge */}
      {scanning && (
        <div style={{
          position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)',
          zIndex: 35,
          background: 'rgba(0,0,0,0.8)', backdropFilter: 'blur(14px)',
          border: '1px solid rgba(200,146,42,0.3)',
          borderRadius: 20, padding: '14px 24px',
          display: 'flex', alignItems: 'center', gap: 10,
          fontSize: 13, fontWeight: 500, color: '#fff',
        }}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: gold, display: 'inline-block', animation: 'pulse 1.1s ease infinite' }} />
          Translating…
        </div>
      )}

      {/* No camera */}
      {noCamera && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 5,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexDirection: 'column', gap: 14, textAlign: 'center', padding: 40,
          background: 'radial-gradient(ellipse at center,#111,#000)',
        }}>
          <div style={{ fontSize: 52 }}>📷</div>
          <p style={{ fontSize: 14, color: 'rgba(255,255,255,0.55)', lineHeight: 1.7 }}>
            Camera access is needed.<br />Please allow permission and try again.
          </p>
          <button onClick={startCamera} style={{
            padding: '13px 28px', borderRadius: 14, border: 'none',
            background: 'linear-gradient(135deg,#c8922a,#8b5e10)',
            color: '#000', fontSize: 14, fontWeight: 700,
            cursor: 'pointer', marginTop: 10,
          }}>
            Enable Camera
          </button>
        </div>
      )}

      <style>{`
        @keyframes pulse { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:.4;transform:scale(.6)} }
      `}</style>
    </div>
  );
}
