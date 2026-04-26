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

interface ARCanvas extends HTMLCanvasElement {
  _scale?: number;
  _panX?: number;
  _panY?: number;
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

  const [scanning, setScanning] = useState(false);
  const [arActive, setArActive] = useState(false);

  // ── Camera
  useEffect(() => {
    (async () => {
      const s = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' }
      });
      streamRef.current = s;
      if (videoRef.current) {
        videoRef.current.srcObject = s;
        await videoRef.current.play();
      }
    })();

    return () => {
      streamRef.current?.getTracks().forEach(t => t.stop());
    };
  }, []);

  // ── Render AR
  const renderAR = useCallback((items: TranslationItem[]) => {
    const canvas = arRef.current;
    const snap = snapshotRef.current;
    if (!canvas || !snap) return;

    const ctx = canvas.getContext('2d')!;
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    ctx.drawImage(snap, 0, 0, canvas.width, canvas.height);

    items.forEach(item => {
      const x = (item.x / 100) * canvas.width;
      const y = (item.y / 100) * canvas.height;
      const w = (item.w / 100) * canvas.width;
      const h = (item.h / 100) * canvas.height;

      ctx.fillStyle = 'rgba(0,0,0,0.7)';
      ctx.fillRect(x, y, w, h);

      ctx.fillStyle = '#fff';
      ctx.font = 'bold 16px sans-serif';
      ctx.fillText(item.translation, x + 4, y - 4);
    });

    canvas.style.display = 'block';
    setArActive(true);
  }, []);

  // ── TRANSLATE
  const translate = useCallback(async (b64: string) => {
    setScanning(true);

    try {
      const res = await fetch('/api/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageBase64: b64 })
      });

      const data = await res.json();
      console.log("API RESULT:", data);

      renderAR(data.items || []);

    } catch (err) {
      console.error(err);
    }

    setScanning(false);
  }, [renderAR]);

  // ── Capture
  const capture = useCallback(() => {
    if (!videoRef.current) return;

    if (flashRef.current) {
      flashRef.current.style.opacity = '0.7';
      setTimeout(() => {
        if (flashRef.current) flashRef.current.style.opacity = '0';
      }, 120);
    }

    const snap = document.createElement('canvas');
    snap.width = videoRef.current.videoWidth;
    snap.height = videoRef.current.videoHeight;
    snap.getContext('2d')!.drawImage(videoRef.current, 0, 0);

    snapshotRef.current = snap;

    const b64 = resizeToB64(snap, 1000, 0.75);
    translate(b64);

  }, [translate]);

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
        onClick={capture}
        style={{
          position: 'absolute',
          bottom: 40,
          left: '50%',
          transform: 'translateX(-50%)',
          fontSize: 24
        }}
      >
        📷
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

    </div>
  );
}
