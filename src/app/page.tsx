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

// ✅ Strongly typed canvas (fixes unsafe mutations)
interface ARCanvas extends HTMLCanvasElement {
  _scale?: number;
  _panX?: number;
  _panY?: number;
  _sx?: number;
  _sy?: number;
  _startX?: number;
  _startY?: number;
  _lastDist?: number;
  _isPinch?: boolean;
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number, r: number
) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function resizeToB64(src: HTMLCanvasElement, maxW: number, quality: number): string {
  let w = src.width, h = src.height;
  if (w > maxW) { h = Math.round(h * maxW / w); w = maxW; }
  const tmp = document.createElement('canvas');
  tmp.width = w; tmp.height = h;
  tmp.getContext('2d')!.drawImage(src, 0, 0, w, h);
  return tmp.toDataURL('image/jpeg', quality).split(',')[1];
}

export default function TranslateVN() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const arRef = useRef<ARCanvas>(null);
  const flashRef = useRef<HTMLDivElement>(null);
  const snapshotRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const autoRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timerCircleRef = useRef<SVGCircleElement | null>(null);
  const flashTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [mode, setModeState] = useState<'tap' | 'auto'>('tap');
  const [scanning, setScanning] = useState(false);
  const [arActive, setArActive] = useState(false);
  const [noCamera, setNoCamera] = useState(false);
  const [facing, setFacing] = useState<'environment' | 'user'>('environment');

  const scanRef = useRef(false); scanRef.current = scanning;
  const arRef2 = useRef(false); arRef2.current = arActive;
  const facingRef = useRef(facing); facingRef.current = facing;

  // ── Camera
  const startCamera = useCallback(async () => {
    setNoCamera(false);
    try {
      streamRef.current?.getTracks().forEach(t => t.stop());
      const s = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: facingRef.current },
        audio: false,
      });
      streamRef.current = s;
      if (videoRef.current) {
        videoRef.current.srcObject = s;
        await videoRef.current.play();
      }
    } catch {
      setNoCamera(true);
    }
  }, []);

  useEffect(() => {
    startCamera();
    return () => {
      streamRef.current?.getTracks().forEach(t => t.stop());
      if (autoRef.current) clearInterval(autoRef.current);
      if (flashTimeoutRef.current) clearTimeout(flashTimeoutRef.current);
    };
  }, [startCamera]);

  // ── Transform
  const applyTransform = (el: ARCanvas) => {
    const scale = el._scale || 1;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    const maxPanX = (vw * (scale - 1)) / 2;
    const maxPanY = (vh * (scale - 1)) / 2;

    el._panX = Math.min(maxPanX, Math.max(-maxPanX, el._panX || 0));
    el._panY = Math.min(maxPanY, Math.max(-maxPanY, el._panY || 0));

    el.style.transform = `translate(${el._panX}px, ${el._panY}px) scale(${scale})`;
    el.style.transformOrigin = 'center center';
  };

  // ── AR render
  const renderAR = useCallback((items: TranslationItem[]) => {
    const snap = snapshotRef.current;
    const canvas = arRef.current;
    if (!snap || !canvas) return;

    const ctx = canvas.getContext('2d')!;
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    ctx.drawImage(snap, 0, 0, canvas.width, canvas.height);

    items.forEach(item => {
      const bx = (item.x / 100) * canvas.width;
      const by = (item.y / 100) * canvas.height;
      const bw = (item.w / 100) * canvas.width;
      const bh = (item.h / 100) * canvas.height;

      const sx = Math.max(0, Math.min(canvas.width - 1, Math.round(bx)));
      const sy = Math.max(0, Math.min(canvas.height - 1, Math.round(by)));
      const sw = Math.max(1, Math.min(canvas.width - sx, Math.round(bw)));
      const sh = Math.max(1, Math.min(canvas.height - sy, Math.round(bh)));

      const sd = ctx.getImageData(sx, sy, sw, sh);

      let r = 0, g = 0, b = 0;
      for (let i = 0; i < sd.data.length; i += 4) {
        r += sd.data[i];
        g += sd.data[i + 1];
        b += sd.data[i + 2];
      }

      const cnt = sd.data.length / 4;
      r = Math.round(r / cnt);
      g = Math.round(g / cnt);
      b = Math.round(b / cnt);

      ctx.fillStyle = `rgba(${r},${g},${b},0.9)`;
      ctx.fillRect(bx, by, bw, bh);

      ctx.fillStyle = '#fff';
      ctx.fillText(item.translation, bx, by - 4);
    });

    canvas.style.display = 'block';
    setArActive(true);
  }, []);

  // ── Capture
  const capture = useCallback(() => {
    if (!videoRef.current) return;

    if (flashRef.current) {
      flashRef.current.style.opacity = '0.7';

      if (flashTimeoutRef.current) clearTimeout(flashTimeoutRef.current);
      flashTimeoutRef.current = setTimeout(() => {
        if (flashRef.current) flashRef.current.style.opacity = '0';
      }, 140);
    }

    const snap = document.createElement('canvas');
    snap.width = videoRef.current.videoWidth;
    snap.height = videoRef.current.videoHeight;

    snap.getContext('2d')!.drawImage(videoRef.current, 0, 0);
    snapshotRef.current = snap;

    // fake data call
    renderAR([]);
  }, [renderAR]);

  // ── Auto
  const runAuto = useCallback(() => {
    if (scanRef.current || arRef2.current) return;
    capture();
  }, [capture]);

  const startAuto = useCallback(() => {
    if (autoRef.current) return;
    runAuto();
    autoRef.current = setInterval(runAuto, 3500);
  }, [runAuto]);

  const stopAuto = useCallback(() => {
    if (autoRef.current) {
      clearInterval(autoRef.current);
      autoRef.current = null;
    }
  }, []);

  // ── Touch handlers
  const touchHandlers = {
    onTouchStart: (e: React.TouchEvent) => {
      const el = e.currentTarget as ARCanvas;

      if (e.touches.length === 1) {
        const t = e.touches[0];
        el._sx = el._startX = t.clientX;
        el._sy = el._startY = t.clientY;
      }

      if (e.touches.length === 2) {
        el._isPinch = true;
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        el._lastDist = Math.hypot(dx, dy);
        el._scale = el._scale || 1;
      }
    },

    onTouchMove: (e: React.TouchEvent) => {
      e.preventDefault();
      const el = e.currentTarget as ARCanvas;

      if (e.touches.length === 2) {
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        const dist = Math.hypot(dx, dy);

        el._scale = Math.min(8, Math.max(1, (el._scale || 1) * (dist / (el._lastDist || dist))));
        el._lastDist = dist;

        applyTransform(el);
      }
    },

    onTouchEnd: (e: React.TouchEvent) => {
      const el = e.currentTarget as ARCanvas;

      if (e.changedTouches.length === 1) {
        const t = e.changedTouches[0];
        const dx = Math.abs(t.clientX - (el._startX || 0));
        const dy = Math.abs(t.clientY - (el._startY || 0));

        if (dx < 12 && dy < 12) {
          el._scale = 1;
          el._panX = 0;
          el._panY = 0;
          applyTransform(el);
          setArActive(false);
        }
      }
    }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#000' }}>

      <video ref={videoRef} autoPlay playsInline muted
        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
      />

      <canvas
        ref={arRef}
        {...touchHandlers}
        style={{ position: 'absolute', inset: 0, display: 'none', touchAction: 'none' }}
      />

      <div ref={flashRef}
        style={{ position: 'absolute', inset: 0, background: '#fff', opacity: 0 }}
      />

      <button onClick={capture}
        style={{ position: 'absolute', bottom: 40, left: '50%', transform: 'translateX(-50%)' }}>
        📷
      </button>

      <button onClick={() => mode === 'auto' ? stopAuto() : startAuto()}
        style={{ position: 'absolute', top: 40, left: 20 }}>
        {mode === 'auto' ? 'Stop Auto' : 'Auto'}
      </button>

    </div>
  );
}
