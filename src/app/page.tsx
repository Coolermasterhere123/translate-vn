'use client';

import { useEffect, useRef, useState, useCallback } from 'react';

interface TranslationItem {
  original: string;
  translation: string;
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

export default function TranslateVN() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const snapshotRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [scanning, setScanning] = useState(false);
  const [arActive, setArActive] = useState(false);

  // ── Camera
  const startCamera = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' }
      });

      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
    } catch (err) {
      console.error('Camera error:', err);
    }
  }, []);

  useEffect(() => {
    startCamera();
    return () => {
      streamRef.current?.getTracks().forEach(t => t.stop());
    };
  }, [startCamera]);

  // ── Render overlay
  const renderAR = useCallback((items: TranslationItem[]) => {
    const canvas = canvasRef.current;
    const snap = snapshotRef.current;
    if (!canvas || !snap) return;

    const ctx = canvas.getContext('2d')!;
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    ctx.drawImage(snap, 0, 0, canvas.width, canvas.height);

    items.forEach(item => {
      const text = (item.translation || '').trim();
      if (!text || text.length < 2) return; // 🚫 remove empty boxes

      const x = (item.x / 100) * canvas.width;
      const y = (item.y / 100) * canvas.height;
      const w = (item.w / 100) * canvas.width;
      const h = (item.h / 100) * canvas.height;

      // Background box
      ctx.fillStyle = 'rgba(0,0,0,0.75)';
      ctx.fillRect(x, y, w, h);

      // English text INSIDE box
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 16px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      const centerY = y + h / 2;

      ctx.fillText(text, x + w / 2, centerY);
    });

    canvas.style.display = 'block';
    setArActive(true);
  }, []);

  // ── Translate
  const translate = useCallback(async (b64: string) => {
    setScanning(true);

    try {
      const res = await fetch('/api/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageBase64: b64 })
      });

      const data = await res.json();

      renderAR(data.items ?? []);

    } catch (err) {
      console.error(err);
    }

    setScanning(false);
  }, [renderAR]);

  // ── Capture (manual only)
  const capture = useCallback(() => {
    if (!videoRef.current || scanning) return;

    const snap = document.createElement('canvas');
    snap.width = videoRef.current.videoWidth || 1280;
    snap.height = videoRef.current.videoHeight || 720;

    snap.getContext('2d')!.drawImage(videoRef.current, 0, 0);

    snapshotRef.current = snap;

    const b64 = resizeToB64(snap, 1000, 0.75);
    translate(b64);

  }, [translate, scanning]);

  // ── Dismiss overlay
  const resetView = () => {
    if (canvasRef.current) canvasRef.current.style.display = 'none';
    setArActive(false);
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#000' }}>

      {/* Live camera */}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
      />

      {/* AR overlay */}
      <canvas
        ref={canvasRef}
        style={{ position: 'absolute', inset: 0, display: 'none', cursor: 'pointer' }}
        onClick={resetView}
      />

      {/* Capture button */}
      <div
        onClick={() => {
          if (arActive) resetView();
          else capture();
        }}
        style={{
          position: 'absolute',
          bottom: 40,
          left: '50%',
          transform: 'translateX(-50%)',
          width: 72,
          height: 72,
          borderRadius: '50%',
          border: '2px solid #c8922a',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 24,
          color: '#fff',
          background: 'rgba(0,0,0,0.4)',
          cursor: 'pointer'
        }}
      >
        {arActive ? '✕' : scanning ? '⏳' : '📷'}
      </div>

      {/* Loading */}
      {scanning && (
        <div style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%,-50%)',
          color: '#fff',
          background: 'rgba(0,0,0,0.6)',
          padding: '10px 20px',
          borderRadius: 12
        }}>
          Translating…
        </div>
      )}

    </div>
  );
}
