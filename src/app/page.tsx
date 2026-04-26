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

// Fit multi-line text INSIDE a box (wrap + shrink-to-fit)
function drawFittedText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number, y: number, w: number, h: number
) {
  const padding = Math.max(3, h * 0.1);
  const maxW = w - padding * 2;
  const maxH = h - padding * 2;

  // Detect price
  const priceMatch = text.match(/([$₫€£]\s?\d+[.,]?\d*|\d+[.,]\d+\s*[$₫€£]?)/);
  let mainText = text;
  let price = '';
  if (priceMatch) {
    price = priceMatch[0];
    mainText = text.replace(price, '').trim();
  }

  let fontSize = Math.max(10, Math.min(18, h * 0.45));

  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';

  const wrapLines = (fs: number) => {
    ctx.font = `600 ${fs}px "Be Vietnam Pro", system-ui, sans-serif`;
    const words = mainText.split(/\s+/);
    const lines: string[] = [];
    let line = '';
    for (const word of words) {
      const test = line ? line + ' ' + word : word;
      if (ctx.measureText(test).width <= maxW) {
        line = test;
      } else {
        if (line) lines.push(line);
        line = word;
      }
    }
    if (line) lines.push(line);
    return lines;
  };

  let lines = wrapLines(fontSize);

  // Shrink until it fits
  while (fontSize > 8) {
    lines = wrapLines(fontSize);
    const lineHeight = fontSize * 1.15;
    const totalH = lines.length * lineHeight + (price ? lineHeight : 0);
    const tooTall = totalH > maxH;
    const tooWide = lines.some(l => ctx.measureText(l).width > maxW);
    if (!tooTall && !tooWide) break;
    fontSize -= 1;
  }

  const lineHeight = fontSize * 1.15;
  let cy = y + padding;

  ctx.fillStyle = '#fff';
  ctx.font = `600 ${fontSize}px "Be Vietnam Pro", system-ui, sans-serif`;

  lines.forEach(line => {
    ctx.fillText(line, x + w / 2, cy);
    cy += lineHeight;
  });

  if (price) {
    ctx.font = `bold ${fontSize}px "Be Vietnam Pro", system-ui, sans-serif`;
    ctx.fillStyle = '#ffd54f';
    ctx.fillText(price, x + w / 2, y + h - lineHeight - padding);
  }
}

export default function TranslateVN() {
  const videoRef       = useRef<HTMLVideoElement>(null);
  const arRef          = useRef<HTMLCanvasElement>(null);
  const flashRef       = useRef<HTMLDivElement>(null);
  const snapshotRef    = useRef<HTMLCanvasElement | null>(null);
  const streamRef      = useRef<MediaStream | null>(null);
  const autoRef        = useRef<ReturnType<typeof setInterval> | null>(null);
  const timerCircleRef = useRef<SVGCircleElement | null>(null);
  const zoomRef        = useRef({ scale: 1, panX: 0, panY: 0, lastDist: 0, isPinch: false, sx: 0, sy: 0 });

  const [mode, setModeState]    = useState<'tap' | 'auto'>('tap');
  const [scanning, setScanning]  = useState(false);
  const [arActive, setArActive]  = useState(false);
  const [noCamera, setNoCamera]  = useState(false);
  const [showHint, setShowHint]  = useState(true);
  const [facing, setFacing]      = useState<'environment' | 'user'>('environment');

  const scanRef   = useRef(false); scanRef.current  = scanning;
  const arRef2    = useRef(false); arRef2.current   = arActive;
  const facingRef = useRef(facing); facingRef.current = facing;

  // ── Pinch/pan transform ─────────────────────────────────────────────────────
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

  // ── Camera ──────────────────────────────────────────────────────────────────
  const startCamera = useCallback(async () => {
    setNoCamera(false);
    try {
      streamRef.current?.getTracks().forEach(t => t.stop());
      const s = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: facingRef.current, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      streamRef.current = s;
      const v = videoRef.current;
      if (v) { v.srcObject = s; await v.play(); }
    } catch { setNoCamera(true); }
  }, []);

  useEffect(() => {
    startCamera();
    const t = setTimeout(() => setShowHint(false), 4000);
    return () => { clearTimeout(t); streamRef.current?.getTracks().forEach(t => t.stop()); };
  }, [startCamera]);

  const flipCamera = useCallback(() => {
    setFacing(p => {
      const next = p === 'environment' ? 'user' : 'environment';
      facingRef.current = next;
      setTimeout(() => startCamera(), 0);
      return next;
    });
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

  // ── AR Renderer ─────────────────────────────────────────────────────────────
  const renderAR = useCallback((items: TranslationItem[], errMsg: string | null) => {
    const snap   = snapshotRef.current;
    const canvas = arRef.current;
    if (!snap || !canvas) return;

    const vw = canvas.offsetWidth  || window.innerWidth;
    const vh = canvas.offsetHeight || window.innerHeight;
    canvas.width = vw; canvas.height = vh;
    const ctx = canvas.getContext('2d')!;

    // Draw snapshot with object-fit:cover math
    const scale = Math.max(vw / snap.width, vh / snap.height);
    const drawW = snap.width  * scale;
    const drawH = snap.height * scale;
    const offX  = (vw - drawW) / 2;
    const offY  = (vh - drawH) / 2;
    ctx.drawImage(snap, offX, offY, drawW, drawH);

    items.forEach(item => {
      const text = (item.translation || '').trim();
      if (!text) return;

      const bx  = offX + (item.x / 100) * drawW;
      const by  = offY + (item.y / 100) * drawH;
      const bw  = (item.w / 100) * drawW;
      const bh  = (item.h / 100) * drawH;

      // Dark background over original text
      ctx.fillStyle = 'rgba(0,0,0,0.72)';
      ctx.fillRect(bx, by, bw, bh);

      // Gold border
      ctx.strokeStyle = 'rgba(200,146,42,0.8)';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(bx, by, bw, bh);

      // Fitted translated text
      drawFittedText(ctx, text, bx, by, bw, bh);

      // Context label above box
      if (item.context) {
        ctx.font = '600 9px "Be Vietnam Pro", system-ui, sans-serif';
        ctx.fillStyle = 'rgba(200,146,42,0.9)';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'bottom';
        ctx.fillText(item.context.toUpperCase(), bx + 3, by - 2);
      }
    });

    if (errMsg || items.length === 0) {
      const msg = errMsg ?? 'No Vietnamese text found';
      ctx.save();
      ctx.fillStyle = 'rgba(0,0,0,0.65)';
      ctx.beginPath();
      ctx.roundRect(vw/2-160, vh/2-28, 320, 56, 14);
      ctx.fill();
      ctx.strokeStyle = 'rgba(200,146,42,0.4)'; ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = errMsg ? '#f85149' : 'rgba(255,255,255,0.45)';
      ctx.font = '500 14px "Be Vietnam Pro", system-ui, sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(msg, vw/2, vh/2);
      ctx.restore();
    }

    zoomRef.current = { scale: 1, panX: 0, panY: 0, lastDist: 0, isPinch: false, sx: 0, sy: 0 };
    canvas.style.transform = '';
    canvas.style.display = 'block';
    setArActive(true);
  }, []);

  // ── Translate ────────────────────────────────────────────────────────────────
  const translate = useCallback(async (b64: string, scanMode: 'full' | 'quick') => {
    setScanning(true);
    try {
      const res  = await fetch('/api/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageBase64: b64, imageMime: 'image/jpeg', mode: scanMode }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      if (scanMode === 'full') renderAR(data.items ?? [], null);
    } catch (err) {
      if (scanMode === 'full') renderAR([], err instanceof Error ? err.message : 'Error');
    }
    setScanning(false);
  }, [renderAR]);

  // ── Capture ──────────────────────────────────────────────────────────────────
  const capture = useCallback((scanMode: 'full' | 'quick') => {
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
    // Higher quality for better OCR
    translate(resizeToB64(snap, scanMode === 'quick' ? 800 : 1200, scanMode === 'quick' ? 0.6 : 0.85), scanMode);
  }, [translate]);

  // ── Auto mode ────────────────────────────────────────────────────────────────
  const stopAuto = useCallback(() => {
    if (autoRef.current) { clearInterval(autoRef.current); autoRef.current = null; }
    const c = timerCircleRef.current;
    if (c) { c.style.transition = 'none'; c.style.strokeDashoffset = '188'; }
  }, []);

  const runAutoCapture = useCallback(() => {
    if (scanRef.current || arRef2.current) return;
    const c = timerCircleRef.current;
    if (c) {
      c.style.transition = 'none'; c.style.strokeDashoffset = '188';
      requestAnimationFrame(() => requestAnimationFrame(() => {
        if (c) { c.style.transition = 'stroke-dashoffset 3.5s linear'; c.style.strokeDashoffset = '0'; }
      }));
    }
    capture('quick');
  }, [capture]);

  const startAuto = useCallback(() => {
    stopAuto(); runAutoCapture();
    autoRef.current = setInterval(runAutoCapture, 3500);
  }, [stopAuto, runAutoCapture]);

  const setMode = useCallback((m: 'tap' | 'auto') => {
    setModeState(m);
    if (arRef2.current) resumeCamera();
    if (m === 'auto') startAuto(); else stopAuto();
  }, [startAuto, stopAuto, resumeCamera]);

  // ── Gallery ──────────────────────────────────────────────────────────────────
  const handleGallery = useCallback((file?: File | null) => {
    if (!file) return;
    stopAuto();
    const reader = new FileReader();
    reader.onload = e => {
      const img = new Image();
      img.onload = () => {
        const tmp = document.createElement('canvas');
        tmp.width = img.width; tmp.height = img.height;
        tmp.getContext('2d')!.drawImage(img, 0, 0);
        snapshotRef.current = tmp;
        translate(resizeToB64(tmp, 1200, 0.85), 'full');
      };
      img.src = e.target!.result as string;
    };
    reader.readAsDataURL(file);
  }, [stopAuto, translate]);

  const onShutter = useCallback(() => {
    if (arRef2.current) { resumeCamera(); return; }
    capture('full');
  }, [capture, resumeCamera]);

  // ── Touch handlers: pinch-zoom + pan ─────────────────────────────────────────
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
      const dist = Math.hypot(dx, dy);
      const delta = dist / zoomRef.current.lastDist;
      zoomRef.current.scale = Math.min(8, Math.max(1, zoomRef.current.scale * delta));
      zoomRef.current.lastDist = dist;
      applyTransform();
    } else if (e.touches.length === 1 && !zoomRef.current.isPinch) {
      if (zoomRef.current.scale <= 1.01) return;
      const moveX = e.touches[0].clientX - zoomRef.current.sx;
      const moveY = e.touches[0].clientY - zoomRef.current.sy;
      zoomRef.current.panX += moveX;
      zoomRef.current.panY += moveY;
      zoomRef.current.sx = e.touches[0].clientX;
      zoomRef.current.sy = e.touches[0].clientY;
      applyTransform();
    }
  }, [applyTransform]);

  const handleTouchEnd = useCallback((e: React.TouchEvent<HTMLCanvasElement>) => {
    if (e.touches.length === 0) {
      if (!zoomRef.current.isPinch && e.changedTouches.length === 1) {
        const t = e.changedTouches[0];
        const dx = Math.abs(t.clientX - zoomRef.current.sx);
        const dy = Math.abs(t.clientY - zoomRef.current.sy);
        if (dx < 12 && dy < 12 && zoomRef.current.scale <= 1.05) {
          resumeCamera();
        }
      }
      zoomRef.current.isPinch = false;
    }
  }, [resumeCamera]);

  const gold = '#c8922a';

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#000' }}>
      {/* Live video */}
      <video
        ref={videoRef}
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', zIndex: 1 }}
        autoPlay playsInline muted
        onClick={() => { if (mode === 'tap' && !scanning && !arActive) capture('full'); }}
      />

      {/* AR canvas — pinch to zoom, drag to pan, tap to dismiss */}
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

      {/* Viewfinder corners */}
      {!arActive && (
        <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-58%)', width: '70vw', maxWidth: 280, aspectRatio: '1', zIndex: 8, pointerEvents: 'none', opacity: 0.65 }}>
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

      {/* Top bar */}
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10, padding: 'max(env(safe-area-inset-top),14px) 20px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'linear-gradient(to bottom,rgba(0,0,0,0.75),transparent)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 34, height: 34, borderRadius: 10, background: 'linear-gradient(135deg,#c8922a,#8b5e10)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, boxShadow: '0 2px 12px rgba(200,146,42,0.4)' }}>🇻🇳</div>
          <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1 }}>
            <span style={{ fontFamily: "'Playfair Display',serif", fontSize: 15, color: '#fff' }}>Translate</span>
            <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.18em', textTransform: 'uppercase', color: gold, marginTop: 2 }}>Vietnamese</span>
          </div>
        </div>
        <div style={{ display: 'flex', background: 'rgba(0,0,0,0.5)', border: '1px solid rgba(200,146,42,0.22)', borderRadius: 20, padding: 3, gap: 2, backdropFilter: 'blur(12px)' }}>
          {(['tap', 'auto'] as const).map(m => (
            <button key={m} onClick={() => setMode(m)} style={{
              padding: '5px 16px', borderRadius: 16, border: 'none',
              background: mode === m ? 'linear-gradient(135deg,#c8922a,#a87520)' : 'transparent',
              color: mode === m ? '#000' : 'rgba(255,255,255,0.45)',
              fontSize: 11, fontWeight: 700, cursor: 'pointer',
              fontFamily: "'Be Vietnam Pro',sans-serif",
              letterSpacing: '0.05em', textTransform: 'uppercase', transition: 'all .2s',
            }}>{m.charAt(0).toUpperCase() + m.slice(1)}</button>
          ))}
        </div>
      </div>

      {/* Auto badge */}
      {mode === 'auto' && (
        <div style={{ position: 'absolute', top: 78, left: '50%', transform: 'translateX(-50%)', zIndex: 10, background: gold, borderRadius: 20, padding: '5px 14px', fontSize: 10, fontWeight: 700, color: '#000', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
          Auto Scanning
        </div>
      )}

      {/* Timer ring */}
      {mode === 'auto' && !arActive && (
        <div style={{ position: 'absolute', bottom: 108, left: '50%', transform: 'translateX(-50%)', zIndex: 10 }}>
          <svg width="48" height="48" viewBox="0 0 64 64" style={{ transform: 'rotate(-90deg)' }}>
            <circle cx="32" cy="32" r="30" fill="none" stroke="rgba(200,146,42,0.2)" strokeWidth="3" />
            <circle ref={timerCircleRef} cx="32" cy="32" r="30" fill="none" stroke={gold} strokeWidth="3" strokeLinecap="round"
              style={{ strokeDasharray: 188, strokeDashoffset: 188 }} />
          </svg>
        </div>
      )}

      {/* Tap hint */}
      {!arActive && (
        <div style={{ position: 'absolute', bottom: 115, left: '50%', transform: 'translateX(-50%)', zIndex: 10, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(10px)', border: '1px solid rgba(200,146,42,0.22)', borderRadius: 20, padding: '8px 18px', fontSize: 12, color: 'rgba(255,255,255,0.75)', whiteSpace: 'nowrap', opacity: showHint ? 1 : 0, pointerEvents: 'none', transition: 'opacity 1s' }}>
          📷 Tap anywhere or press the button to translate
        </div>
      )}

      {/* AR legend */}
      {arActive && (
        <div style={{ position: 'absolute', top: 76, left: '50%', transform: 'translateX(-50%)', zIndex: 10, background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(10px)', border: '1px solid rgba(200,146,42,0.22)', borderRadius: 20, padding: '6px 14px', fontSize: 11, color: 'rgba(255,255,255,0.6)', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ color: '#e8b84b', fontWeight: 700 }}>EN</span> overlaid · Pinch to zoom · Tap to dismiss
        </div>
      )}

      {/* Bottom bar */}
      <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, zIndex: 10, padding: '20px 28px max(env(safe-area-inset-bottom),24px)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 28, background: 'linear-gradient(to top,rgba(0,0,0,0.82),transparent)' }}>
        <label style={{ width: 48, height: 48, borderRadius: '50%', border: '1px solid rgba(255,255,255,0.15)', background: 'rgba(0,0,0,0.35)', color: 'white', fontSize: 18, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', backdropFilter: 'blur(8px)', flexShrink: 0 }}>
          🖼️
          <input type="file" accept="image/*" style={{ display: 'none' }} onChange={e => handleGallery(e.target.files?.[0])} />
        </label>

        <div onClick={onShutter} style={{ width: 72, height: 72, borderRadius: '50%', border: `2px solid ${scanning ? '#e8b84b' : gold}`, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', backdropFilter: 'blur(8px)', boxShadow: scanning ? '0 0 30px rgba(232,184,75,0.5)' : '0 0 20px rgba(200,146,42,0.3)', transition: 'box-shadow .2s,border-color .2s', flexShrink: 0 }}>
          <span style={{ fontSize: 24 }}>{arActive ? '✕' : scanning ? '⏳' : '📷'}</span>
        </div>

        <button onClick={flipCamera} style={{ width: 48, height: 48, borderRadius: '50%', border: '1px solid rgba(255,255,255,0.15)', background: 'rgba(0,0,0,0.35)', color: 'white', fontSize: 18, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', backdropFilter: 'blur(8px)', flexShrink: 0 }}>
          🔄
        </button>
      </div>

      {/* Scanning badge */}
      {scanning && (
        <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', zIndex: 15, background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(14px)', border: '1px solid rgba(200,146,42,0.22)', borderRadius: 20, padding: '14px 24px', display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, fontWeight: 500 }}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: gold, display: 'inline-block', animation: 'pulse 1.1s ease infinite' }} />
          Translating…
        </div>
      )}

      {/* No camera */}
      {noCamera && (
        <div style={{ position: 'absolute', inset: 0, zIndex: 5, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 14, textAlign: 'center', padding: 40, background: 'radial-gradient(ellipse at center,#111,#000)' }}>
          <div style={{ fontSize: 52 }}>📷</div>
          <p style={{ fontSize: 14, color: 'rgba(255,255,255,0.55)', lineHeight: 1.7 }}>
            Camera access is needed.<br />Please allow permission and try again.
          </p>
          <button onClick={startCamera} style={{ padding: '13px 28px', borderRadius: 14, border: 'none', background: 'linear-gradient(135deg,#c8922a,#8b5e10)', color: '#000', fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: "'Be Vietnam Pro',sans-serif", marginTop: 10 }}>
            Enable Camera
          </button>
        </div>
      )}

      <style>{`@keyframes pulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.4;transform:scale(.6)}}`}</style>
    </div>
  );
}
