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

  const [mode, setModeState] = useState<'tap' | 'auto'>('tap');
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
    };
  }, [startCamera]);

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

      ctx.fillStyle = 'rgba(0,0,0,0.7)';
      roundRect(ctx, bx, by, bw, bh, 6);
      ctx.fill();

      ctx.fillStyle = '#fff';
      ctx.font = 'bold 16px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(item.translation, bx + bw / 2, by - 4);
    });

    canvas.style.display = 'block';
    setArActive(true);
  }, []);

  // ── TRANSLATE (FIXED)
  const translate = useCallback(async (b64: string) => {
    setScanning(true);

    try {
      const res = await fetch('/api/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageBase64: b64 }),
      });

      const data = await res.json();
      console.log('API RESULT:', data);

      renderAR(data.items ?? []);

    } catch (err) {
      console.error(err);
      renderAR([]);
    }

    setScanning(false);
  }, [renderAR]);

  // ── CAPTURE (CRITICAL FIX)
  const capture = useCallback(() => {
    if (!videoRef.current || scanRef.current) return;

    if (flashRef.current) {
      flashRef.current.style.opacity = '0.7';
      setTimeout(() => {
        if (flashRef.current) flashRef.current.style.opacity = '0';
      }, 120);
    }

    const snap = document.createElement('canvas');
    snap.width = videoRef.current.videoWidth || 1280;
    snap.height = videoRef.current.videoHeight || 720;

    snap.getContext('2d')!.drawImage(videoRef.current, 0, 0);
    snapshotRef.current = snap;

    // 🔥 THIS WAS MISSING
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

  const onShutter = () => {
    if (arActive) {
      if (arRef.current) arRef.current.style.display = 'none';
      setArActive(false);
      return;
    }
    capture();
  };

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
        onClick={() => {
          if (arRef.current) arRef.current.style.display = 'none';
          setArActive(false);
        }}
      />

      <div
        ref={flashRef}
        style={{ position: 'absolute', inset: 0, background: '#fff', opacity: 0 }}
      />

      <button
        onClick={onShutter}
        style={{
          position: 'absolute',
          bottom: 40,
          left: '50%',
          transform: 'translateX(-50%)',
          fontSize: 26
        }}
      >
        {arActive ? '✕' : scanning ? '⏳' : '📷'}
      </button>

      <button
        onClick={() => mode === 'auto' ? stopAuto() : startAuto()}
        style={{ position: 'absolute', top: 40, left: 20 }}
      >
        {mode === 'auto' ? 'Stop Auto' : 'Auto'}
      </button>

      {scanning && (
        <div style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%,-50%)',
          color: '#fff'
        }}>
          Translating...
        </div>
      )}

      {noCamera && (
        <div style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#fff'
        }}>
          Camera permission needed
        </div>
      )}
    </div>
  );
}
