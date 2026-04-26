'use client';

import { useEffect, useRef, useState, useCallback } from 'react';

interface TranslationItem {
  original: string;
  translation: string;
  // percentages (0–100) relative to the ORIGINAL image
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

  // 🔍 Detect price (keeps it visible)
  const priceMatch = text.match(/([$₫€£]\s?\d+[.,]?\d*)/);
  let mainText = text;
  let price = '';

  if (priceMatch) {
    price = priceMatch[0];
    mainText = text.replace(price, '').trim();
  }

  // Start SMALLER than before (menu friendly)
  let fontSize = Math.max(10, Math.min(18, h * 0.45));

  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';

  const wrapLines = (fs: number) => {
    ctx.font = `600 ${fs}px system-ui, sans-serif`;

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

  // 🔻 Shrink until it fits perfectly
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
  ctx.font = `600 ${fontSize}px system-ui, sans-serif`;

  // 🧾 Draw main text
  lines.forEach(line => {
    ctx.fillText(line, x + w / 2, cy);
    cy += lineHeight;
  });

  // 💰 Draw price LAST (always visible)
  if (price) {
    ctx.font = `bold ${fontSize}px system-ui, sans-serif`;
    ctx.fillStyle = '#ffd54f'; // subtle highlight
    ctx.fillText(price, x + w / 2, y + h - lineHeight);
  }
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

  // ── Render overlay (KEY: use same "cover" math as drawing image)
  const renderAR = useCallback((items: TranslationItem[]) => {
    const canvas = canvasRef.current;
    const snap = snapshotRef.current;
    if (!canvas || !snap) return;

    const ctx = canvas.getContext('2d')!;
    const vw = canvas.clientWidth || window.innerWidth;
    const vh = canvas.clientHeight || window.innerHeight;

    canvas.width = vw;
    canvas.height = vh;

    // "cover" scaling to match your <video object-fit="cover">
    const scale = Math.max(vw / snap.width, vh / snap.height);
    const drawW = snap.width * scale;
    const drawH = snap.height * scale;
    const offX = (vw - drawW) / 2;
    const offY = (vh - drawH) / 2;

    // draw snapshot
    ctx.drawImage(snap, offX, offY, drawW, drawH);

    // draw each translation EXACTLY over its box
    items.forEach(item => {
      const text = (item.translation || '').trim();
      if (!text) return; // skip empties

      // map percentage box → canvas pixels with SAME scale/offset
      const x = offX + (item.x / 100) * drawW;
      const y = offY + (item.y / 100) * drawH;
      const w = (item.w / 100) * drawW;
      const h = (item.h / 100) * drawH;

      // background (optional: slight opacity)
      ctx.fillStyle = 'rgba(0,0,0,0.65)';
      ctx.fillRect(x, y, w, h);

      // text fitted INSIDE the box
      drawFittedText(ctx, text, x, y, w, h);
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

  // ── Capture (manual)
  const capture = useCallback(() => {
    if (!videoRef.current || scanning) return;

    const snap = document.createElement('canvas');
    snap.width = videoRef.current.videoWidth || 1280;
    snap.height = videoRef.current.videoHeight || 720;
    snap.getContext('2d')!.drawImage(videoRef.current, 0, 0);

    snapshotRef.current = snap;

    const b64 = resizeToB64(snap, 1200, 0.85); // keep more detail → better boxes
    translate(b64);
  }, [translate, scanning]);

  const resetView = () => {
    if (canvasRef.current) canvasRef.current.style.display = 'none';
    setArActive(false);
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
        ref={canvasRef}
        style={{ position: 'absolute', inset: 0, display: 'none', cursor: 'pointer' }}
        onClick={resetView}
      />

      <div
        onClick={() => (arActive ? resetView() : capture())}
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
