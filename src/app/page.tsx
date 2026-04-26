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
  const flashTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [mode, setMode] = useState<'tap' | 'auto'>('tap');
  const [scanning, setScanning] = useState(false);
  const [arActive, setArActive] = useState(false);
  const [noCamera, setNoCamera] = useState(false);

  const scanRef = useRef(false); scanRef.current = scanning;
  const arRef2 = useRef(false); arRef2.current = arActive;

  // ── Camera
  const startCamera = useCallback(async () => {
    setNoCamera(false);
    try {
      streamRef.current?.getTracks().forEach(t => t.stop());

      const s = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
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
      ctx.font = 'bold 16px sans-serif';
      ctx.fillText(item.translation, bx + bw / 2, by - 4);
    });

    canvas.style.display = 'block';
    setArActive(true);
  }, []);

  // ── TRANSLATE (RESTORED)
  const translate = useCallback(async (b64: string) => {
    setScanning(true);

    try {
      const res = await fetch('/api/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageBase64: b64 }),
      });

      const data = await res.json();

      if (data.error) throw new Error(data.error);

      renderAR(data.items ?? []);
    } catch (err) {
      console.error(err);
      renderAR([]);
    }

    setScanning(false);
  }, [renderAR]);

  // ── Capture (FIXED)
  const capture = useCallback(() => {
    if (!videoRef.current || scanRef.current) return;

    if (flashRef.current) {
      flashRef.current.style.opacity = '0.7';

      if (flashTimeoutRef.current) clearTimeout(flashTimeoutRef.current);
      flashTimeoutRef.current = setTimeout(() => {
        if (flashRef.current) flashRef.current.style.opacity = '0';
      }, 140);
    }

    const snap = document.createElement('canvas');
    snap.width = videoRef.current.videoWidth || 1280;
    snap.height = videoRef.current.videoHeight || 720;

    snap.getContext('2d')!.drawImage(videoRef.current, 0, 0);

    snapshotRef.current = snap;

    const b64 = resizeToB64(snap, 1000, 0.75);
    translate(b64);

  }, [translate]);

  // ── Auto mode
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

  // ── UI
  return (
    <div style={{ position: 'fixed', inset: 0, background: '#000' }}>

      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
      />

      <canvas
        ref={arRef}
        style={{ position: 'absolute', inset: 0, display: 'none' }}
      />

      <div
        ref={flashRef}
        style={{ position: 'absolute', inset: 0, background: '#fff', opacity: 0 }}
      />

      <button
        onClick={capture}
        style={{ position: 'absolute', bottom: 40, left: '50%', transform: 'translateX(-50%)' }}
      >
        📷
      </button>

      <button
        onClick={() => mode === 'auto' ? stopAuto() : startAuto()}
        style={{ position: 'absolute', top: 40, left: 20 }}
      >
        {mode === 'auto' ? 'Stop Auto' : 'Auto'}
      </button>

    </div>
  );
}
