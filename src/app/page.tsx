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

type TrackedItem = TranslationItem & {
  id: string;
  life: number;
};

function resizeToB64(src: HTMLCanvasElement, maxW: number, quality: number): string {
  let w = src.width, h = src.height;
  if (w > maxW) { h = Math.round(h * maxW / w); w = maxW; }
  const tmp = document.createElement('canvas');
  tmp.width = w; tmp.height = h;
  tmp.getContext('2d')!.drawImage(src, 0, 0, w, h);
  return tmp.toDataURL('image/jpeg', quality).split(',')[1];
}

function getFrameHash(canvas: HTMLCanvasElement): string {
  const small = document.createElement('canvas');
  small.width = 32;
  small.height = 32;

  const ctx = small.getContext('2d')!;
  ctx.drawImage(canvas, 0, 0, 32, 32);

  const data = ctx.getImageData(0, 0, 32, 32).data;

  let hash = 0;
  for (let i = 0; i < data.length; i += 16) {
    hash = ((hash << 5) - hash) + data[i];
    hash |= 0;
  }

  return hash.toString();
}

export default function TranslateVN() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const snapshotRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const loopRef = useRef(false);
  const lastHashRef = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const trackedRef = useRef<TrackedItem[]>([]);

  const [scanning, setScanning] = useState(false);
  const scanRef = useRef(false); scanRef.current = scanning;

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

  // ── Matching logic
  function matchItem(a: TranslationItem, b: TranslationItem) {
    return a.translation === b.translation &&
      Math.abs(a.x - b.x) < 10 &&
      Math.abs(a.y - b.y) < 10;
  }

  // ── Tracking system
  function updateTrackedItems(newItems: TranslationItem[]) {
    const tracked = trackedRef.current;

    // decay
    tracked.forEach(t => t.life--);

    newItems.forEach(item => {
      const text = (item.translation || '').trim();
      if (!text || text.length < 2) return;

      const existing = tracked.find(t => matchItem(t, item));

      if (existing) {
        // smooth + lock
        existing.x = existing.x * 0.9 + item.x * 0.1;
        existing.y = existing.y * 0.9 + item.y * 0.1;
        existing.w = existing.w * 0.9 + item.w * 0.1;
        existing.h = existing.h * 0.9 + item.h * 0.1;

        existing.translation = text;
        existing.life = 10;
      } else {
        tracked.push({
          ...item,
          translation: text,
          id: Math.random().toString(36),
          life: 10
        });
      }
    });

    trackedRef.current = tracked.filter(t => t.life > 0);
  }

  // ── Render
  const renderAR = useCallback((items: TranslationItem[]) => {
    const canvas = canvasRef.current;
    const snap = snapshotRef.current;
    if (!canvas || !snap) return;

    const ctx = canvas.getContext('2d')!;
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    ctx.drawImage(snap, 0, 0, canvas.width, canvas.height);

    updateTrackedItems(items);

    trackedRef.current.forEach(item => {
      const x = (item.x / 100) * canvas.width;
      const y = (item.y / 100) * canvas.height;
      const w = (item.w / 100) * canvas.width;
      const h = (item.h / 100) * canvas.height;

      const alpha = Math.min(1, item.life / 10);

      ctx.globalAlpha = alpha;
      ctx.fillStyle = 'rgba(0,0,0,0.75)';
      ctx.fillRect(x, y, w, h);

      ctx.fillStyle = '#fff';
      ctx.font = 'bold 16px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(item.translation, x + w / 2, y - 4);

      ctx.globalAlpha = 1;
    });
  }, []);

  // ── Translate
  const translate = useCallback(async (b64: string) => {
    if (abortRef.current) abortRef.current.abort();

    const controller = new AbortController();
    abortRef.current = controller;

    setScanning(true);

    try {
      const res = await fetch('/api/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageBase64: b64 }),
        signal: controller.signal
      });

      const data = await res.json();

      if (!controller.signal.aborted) {
        renderAR(data.items ?? []);
      }

    } catch (err: any) {
      if (err.name !== 'AbortError') {
        console.error(err);
      }
    }

    setScanning(false);
  }, [renderAR]);

  // ── Capture
  const capture = useCallback(async () => {
    if (!videoRef.current || scanRef.current) return;

    const snap = document.createElement('canvas');
    snap.width = videoRef.current.videoWidth || 1280;
    snap.height = videoRef.current.videoHeight || 720;

    snap.getContext('2d')!.drawImage(videoRef.current, 0, 0);

    const hash = getFrameHash(snap);

    if (hash === lastHashRef.current) return;
    lastHashRef.current = hash;

    snapshotRef.current = snap;

    const b64 = resizeToB64(snap, 900, 0.7);
    await translate(b64);

  }, [translate]);

  // ── Real-time loop
  const startRealtime = useCallback(() => {
    if (loopRef.current) return;
    loopRef.current = true;

    const loop = async () => {
      if (!loopRef.current) return;

      const start = performance.now();

      if (!scanRef.current) {
        await capture();
      }

      const duration = performance.now() - start;
      const delay = Math.max(800, 1400 - duration);

      setTimeout(loop, delay);
    };

    loop();
  }, [capture]);

  // ── Lifecycle
  useEffect(() => {
    startCamera();
    startRealtime();

    return () => {
      loopRef.current = false;
      abortRef.current?.abort();
      streamRef.current?.getTracks().forEach(t => t.stop());
    };
  }, [startCamera, startRealtime]);

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
        ref={canvasRef}
        style={{ position: 'absolute', inset: 0 }}
      />

      {scanning && (
        <div style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%,-50%)',
          color: '#fff'
        }}>
          Translating…
        </div>
      )}
    </div>
  );
}
