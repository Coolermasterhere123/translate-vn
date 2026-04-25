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
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
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
  const videoRef    = useRef<HTMLVideoElement>(null);
  const arRef       = useRef<HTMLCanvasElement>(null);
  const flashRef    = useRef<HTMLDivElement>(null);
  const snapshotRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef   = useRef<MediaStream | null>(null);
  const autoRef     = useRef<ReturnType<typeof setInterval> | null>(null);
  const timerCircleRef = useRef<SVGCircleElement | null>(null);

  const [mode, setModeState]   = useState<'tap' | 'auto'>('tap');
  const [scanning, setScanning] = useState(false);
  const [arActive, setArActive] = useState(false);
  const [noCamera, setNoCamera] = useState(false);
  const [showHint, setShowHint] = useState(true);
  const [facing, setFacing]    = useState<'environment' | 'user'>('environment');

  const scanRef    = useRef(false); scanRef.current = scanning;
  const arRef2     = useRef(false); arRef2.current  = arActive;
  const facingRef  = useRef(facing); facingRef.current = facing;

  // ── Camera ─────────────────────────────────────────────────────────────────
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
    const canvas = arRef.current as any;
    if (canvas) {
      // Reset transform style and properties
      canvas.style.transform = '';
      canvas._scale = 1;
      canvas._panX = 0;
      canvas._panY = 0;
      // Hide the AR overlay
      canvas.style.display = 'none';
    }
    snapshotRef.current = null;
    setArActive(false);
  }, []);

  // Helper function to apply transform based on pan and scale
  const applyTransform = (el: any) => {
    const scale = el._scale || 1;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    // Clamp pan so image stays on screen
    const maxPanX = (vw * (scale - 1)) / 2;
    const maxPanY = (vh * (scale - 1)) / 2;
    el._panX = Math.min(maxPanX, Math.max(-maxPanX, el._panX || 0));
    el._panY = Math.min(maxPanY, Math.max(-maxPanY, el._panY || 0));
    el.style.transform = `translate(${el._panX}px, ${el._panY}px) scale(${scale})`;
    el.style.transformOrigin = 'center center';
  };

  // ── AR Renderer ────────────────────────────────────────────────────────────
  const renderAR = useCallback((items: TranslationItem[], errMsg: string | null) => {
    const snap = snapshotRef.current;
    const canvas = arRef.current;
    if (!snap || !canvas) return;

    const vw = canvas.offsetWidth  || window.innerWidth;
    const vh = canvas.offsetHeight || window.innerHeight;
    canvas.width = vw; canvas.height = vh;
    const ctx = canvas.getContext('2d')!;

    const scale = Math.max(vw / snap.width, vh / snap.height);
    const drawW = snap.width  * scale;
    const drawH = snap.height * scale;
    const offX  = (vw - drawW) / 2;
    const offY  = (vh - drawH) / 2;
    ctx.drawImage(snap, offX, offY, drawW, drawH);

    items.forEach(item => {
      const bx  = offX + (item.x / 100) * drawW;
      const by  = offY + (item.y / 100) * drawH;
      const bw  = (item.w / 100) * drawW;
      const bh  = (item.h / 100) * drawH;
      const pad = Math.max(4, bh * 0.12);

      const sd  = ctx.getImageData(Math.max(0,Math.round(bx)), Math.max(0,Math.round(by)), Math.max(1,Math.round(bw)), Math.max(1,Math.round(bh)));
      let r=0, g=0, b=0;
      const cnt = sd.data.length / 4;
      for (let i=0; i<sd.data.length; i+=4) { r+=sd.data[i]; g+=sd.data[i+1]; b+=sd.data[i+2]; }
      r=Math.round(r/cnt); g=Math.round(g/cnt); b=Math.round(b/cnt);

      ctx.save();
      ctx.fillStyle = `rgba(${r},${g},${b},0.94)`;
      roundRect(ctx, bx-pad, by-pad, bw+pad*2, bh+pad*2, 6);
      ctx.fill();
      ctx.strokeStyle = 'rgba(200,146,42,0.7)';
      ctx.lineWidth = 1.5;
      roundRect(ctx, bx-pad, by-pad, bw+pad*2, bh+pad*2, 6);
      ctx.stroke();
      ctx.restore();

      const luma      = 0.299*r + 0.587*g + 0.114*b;
      const textColor = luma > 145 ? '#111' : '#fff';
      const availW    = bw + pad*2 - 8;
      let fontSize    = Math.max(10, bh * 0.72);
      ctx.font = `700 ${fontSize}px "Be Vietnam Pro", sans-serif`;
      while (fontSize > 8 && ctx.measureText(item.translation).width > availW) {
        fontSize -= 0.5;
        ctx.font = `700 ${fontSize}px "Be Vietnam Pro", sans-serif`;
      }
      ctx.save();
      ctx.fillStyle = textColor; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
      ctx.fillText(item.translation, bx-pad+5, by+bh/2, availW);
      ctx.restore();

      if (item.context) {
        ctx.save();
        ctx.font = '600 9px "Be Vietnam Pro", sans-serif';
        ctx.fillStyle = 'rgba(200,146,42,0.9)';
        ctx.textBaseline = 'bottom'; ctx.textAlign = 'left';
        ctx.fillText(item.context.toUpperCase(), bx-pad+4, by-pad-2);
        ctx.restore();
      }
    });

    if (errMsg || items.length === 0) {
      const msg = errMsg ?? 'No Vietnamese text found';
      ctx.save();
      ctx.fillStyle = 'rgba(0,0,0,0.65)';
      roundRect(ctx, vw/2-160, vh/2-28, 320, 56, 14); ctx.fill();
      ctx.strokeStyle = 'rgba(200,146,42,0.4)'; ctx.lineWidth = 1;
      roundRect(ctx, vw/2-160, vh/2-28, 320, 56, 14); ctx.stroke();
      ctx.fillStyle = errMsg ? '#f85149' : 'rgba(255,255,255,0.45)';
      ctx.font = '500 14px "Be Vietnam Pro", sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(msg, vw/2, vh/2);
      ctx.restore();
    }

    canvas.style.display = 'block';
    setArActive(true);
  }, []);

  // ── Translate ──────────────────────────────────────────────────────────────
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

  // ── Capture ────────────────────────────────────────────────────────────────
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
    translate(resizeToB64(snap, scanMode === 'quick' ? 800 : 1000, scanMode === 'quick' ? 0.6 : 0.75), scanMode);
  }, [translate]);

  // ── Auto mode ──────────────────────────────────────────────────────────────
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

  // ── Gallery ────────────────────────────────────────────────────────────────
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
        translate(resizeToB64(tmp, 1000, 0.78), 'full');
      };
      img.src = e.target!.result as string;
    };
    reader.readAsDataURL(file);
  }, [stopAuto, translate]);

  const onShutter = useCallback(() => {
    if (arRef2.current) { resumeCamera(); return; }
    capture('full');
  }, [capture, resumeCamera]);

  // ── Inline styles ──────────────────────────────────────────────────────────
  const gold = '#c8922a';

  // Your existing JSX code...

  // ── Add the applyTransform function just before the return statement in the component
  const applyTransform = (el: any) => {
    const scale = el._scale || 1;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    // Clamp pan so image stays on screen
    const maxPanX = (vw * (scale - 1)) / 2;
    const maxPanY = (vh * (scale - 1)) / 2;
    el._panX = Math.min(maxPanX, Math.max(-maxPanX, el._panX || 0));
    el._panY = Math.min(maxPanY, Math.max(-maxPanY, el._panY || 0));
    el.style.transform = `translate(${el._panX}px, ${el._panY}px) scale(${scale})`;
    el.style.transformOrigin = 'center center';
  };

  return (
    <div style={{ position:'fixed', inset:0, background:'#000'}}>
      {/* your existing JSX... */}
      {/* (the complete JSX code stays the same) */}
    </div>
  );
}
