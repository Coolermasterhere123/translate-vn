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
  const videoRef    = useRef<HTMLVideoElement>(null);
  const arRef       = useRef<HTMLCanvasElement>(null);
  const flashRef    = useRef<HTMLDivElement>(null);
  const snapshotRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef   = useRef<MediaStream | null>(null);
  const autoRef     = useRef<ReturnType<typeof setInterval> | null>(null);
  const timerCircleRef = useRef<SVGCircleElement | null>(null);

  const [mode, setModeState] = useState<'tap' | 'auto'>('tap');
  const [scanning, setScanning] = useState(false);
  const [arActive, setArActive] = useState(false);
  const [noCamera, setNoCamera] = useState(false);
  const [showHint, setShowHint] = useState(true);
  const [facing, setFacing] = useState<'environment' | 'user'>('environment');

  const scanRef = useRef(false); scanRef.current = scanning;
  const arRef2 = useRef(false); arRef2.current = arActive;
  const facingRef = useRef(facing); facingRef.current = facing;

  // ── Camera setup
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
      canvas.style.transform = '';
      canvas._scale = 1;
      canvas._panX = 0;
      canvas._panY = 0;
      canvas.style.display = 'none';
    }
    snapshotRef.current = null;
    setArActive(false);
  }, []);

  // ── AR rendering
  const renderAR = useCallback((items: TranslationItem[], errMsg: string | null) => {
    const snap = snapshotRef.current;
    const canvas = arRef.current;
    if (!snap || !canvas) return;

    const vw = canvas.offsetWidth || window.innerWidth;
    const vh = canvas.offsetHeight || window.innerHeight;
    canvas.width = vw;
    canvas.height = vh;
    const ctx = canvas.getContext('2d')!;

    const scale = Math.max(vw / snap.width, vh / snap.height);
    const drawW = snap.width * scale;
    const drawH = snap.height * scale;
    const offX = (vw - drawW) / 2;
    const offY = (vh - drawH) / 2;
    ctx.drawImage(snap, offX, offY, drawW, drawH);

    // Draw each item
    items.forEach(item => {
      const bx = offX + (item.x / 100) * drawW;
      const by = offY + (item.y / 100) * drawH;
      const bw = (item.w / 100) * drawW;
      const bh = (item.h / 100) * drawH;
      const pad = Math.max(4, bh * 0.12);

      const sd = ctx.getImageData(Math.max(0, Math.round(bx)), Math.max(0, Math.round(by)), Math.max(1, Math.round(bw)), Math.max(1, Math.round(bh)));
      let r=0, g=0, b=0;
      const cnt = sd.data.length / 4;
      for (let i=0; i<sd.data.length; i+=4) {
        r+=sd.data[i]; g+=sd.data[i+1]; b+=sd.data[i+2];
      }
      r = Math.round(r/cnt);
      g = Math.round(g/cnt);
      b = Math.round(b/cnt);

      ctx.save();
      ctx.fillStyle = `rgba(${r},${g},${b},0.94)`;
      roundRect(ctx, bx - pad, by - pad, bw + pad*2, bh + pad*2, 6);
      ctx.fill();
      ctx.strokeStyle = 'rgba(200,146,42,0.7)';
      ctx.lineWidth = 1.5;
      roundRect(ctx, bx - pad, by - pad, bw + pad*2, bh + pad*2, 6);
      ctx.stroke();
      ctx.restore();

      // Draw the translation **above** the bounding box
      ctx.font = `bold ${Math.max(10, bh * 0.72)}px "Be Vietnam Pro", sans-serif`;
      ctx.fillStyle = (0.299*r + 0.587*g + 0.114*b) > 145 ? '#111' : '#fff';
      ctx.textBaseline = 'bottom';
      ctx.textAlign = 'left';
      ctx.fillText(item.translation, bx, by - 4); // position above box
    });

    // Error or no items message
    if (errMsg || items.length === 0) {
      const msg = errMsg ?? 'No Vietnamese text found';
      ctx.save();
      ctx.fillStyle = 'rgba(0,0,0,0.65)';
      roundRect(ctx, vw/2-160, vh/2-28, 320, 56, 14);
      ctx.fill();
      ctx.strokeStyle = 'rgba(200,146,42,0.4)';
      ctx.lineWidth = 1;
      roundRect(ctx, vw/2-160, vh/2-28, 320, 56, 14);
      ctx.stroke();
      ctx.fillStyle = '#fff';
      ctx.font = '500 14px "Be Vietnam Pro", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(msg, vw/2, vh/2);
      ctx.restore();
    }

    canvas.style.display = 'block';
    setArActive(true);
  }, []);

  // ── translate API call
  const translate = useCallback(async (b64: string, scanMode: 'full' | 'quick') => {
    setScanning(true);
    try {
      const res = await fetch('/api/translate', {
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

  // Capture image
  const capture = useCallback((scanMode: 'full' | 'quick') => {
    if (scanRef.current || !videoRef.current) return;
    if (flashRef.current) {
      flashRef.current.style.opacity = '0.7';
      setTimeout(() => { if (flashRef.current) flashRef.current.style.opacity = '0'; }, 140);
    }
    const snap = document.createElement('canvas');
    snap.width = videoRef.current.videoWidth || 1280;
    snap.height = videoRef.current.videoHeight || 720;
    snap.getContext('2d')!.drawImage(videoRef.current, 0, 0, snap.width, snap.height);
    snapshotRef.current = snap;
    translate(resizeToB64(snap, scanMode === 'quick' ? 800 : 1000, scanMode === 'quick' ? 0.6 : 0.75), scanMode);
  }, [translate]);

  // Auto scan
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

  // --- The fix: define applyTransform just before return ---
  const applyTransform = (el: any) => {
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

  // =================== JSX Content ===================
  return (
    <div style={{ position:'fixed', inset:0, background:'#000' }}>
      
      {/* Live video */}
      <video
        ref={videoRef}
        style={{ position:'absolute', inset:0, width:'100%', height:'100%', objectFit:'cover', zIndex:1 }}
        autoPlay playsInline muted
        onClick={() => { if (mode==='tap' && !scanning && !arActive) capture('full'); }}
      />

      {/* AR canvas — pinch to zoom + pan */}
      <canvas
        ref={arRef}
        style={{
          position:'absolute', inset:0, width:'100%', height:'100%',
          zIndex:2, cursor:'pointer', display:'none', touchAction:'none'
        }}
        onTouchStart={(e) => {
          const el = e.currentTarget as any;
          if (e.touches.length === 1) {
            el._sx = e.touches[0].clientX;
            el._sy = e.touches[0].clientY;
            el._panX = el._panX || 0;
            el._panY = el._panY || 0;
            el._isPinch = false;
          } else if (e.touches.length === 2) {
            el._isPinch = true;
            const dx = e.touches[0].clientX - e.touches[1].clientX;
            const dy = e.touches[0].clientY - e.touches[1].clientY;
            el._lastDist = Math.hypot(dx, dy);
            el._scale = el._scale || 1;
            el._midX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
            el._midY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
          }
        }}
        onTouchMove={(e) => {
          e.preventDefault();
          const el = e.currentTarget as any;
          if (e.touches.length === 2) {
            // Pinch zoom
            el._isPinch = true;
            const dx = e.touches[0].clientX - e.touches[1].clientX;
            const dy = e.touches[0].clientY - e.touches[1].clientY;
            const dist = Math.hypot(dx, dy);
            const scaleDelta = dist / el._lastDist;
            el._scale = Math.min(8, Math.max(1, (el._scale || 1) * scaleDelta));
            el._lastDist = dist;
            applyTransform(el);
          } else if (e.touches.length === 1 && !el._isPinch) {
            // Pan
            const moveX = e.touches[0].clientX - el._sx;
            const moveY = e.touches[0].clientY - el._sy;
            el._panX = (el._panX || 0) + moveX;
            el._panY = (el._panY || 0) + moveY;
            el._sx = e.touches[0].clientX;
            el._sy = e.touches[0].clientY;
            applyTransform(el);
          }
        }}
        onTouchEnd={(e) => {
          const el = e.currentTarget as any;
          if (!el._isPinch && e.changedTouches.length === 1 && e.touches.length === 0) {
            const t = e.changedTouches[0];
            const dx = Math.abs(t.clientX - (el._sx || 0));
            const dy = Math.abs(t.clientY - (el._sy || 0));
            if (dx < 12 && dy < 12 && (el._scale || 1) <= 1.05) {
              el._scale = 1; el._panX = 0; el._panY = 0;
              applyTransform(el);
              resumeCamera();
            }
          }
          if (e.touches.length === 0) el._isPinch = false;
        }}
        onClick={(e) => {
          const el = e.currentTarget as any;
          if (arActive && (el?._scale || 1) <= 1.05) resumeCamera();
        }}
      />

      {/* Flash overlay */}
      <div ref={flashRef} style={{ position:'absolute', inset:0, zIndex:25, background:'white', opacity:0, pointerEvents:'none', transition:'opacity .12s' }} />

      {/* Viewfinder corners — removed overlay */}
      
      {/* Top control bar */}
      <div style={{ position:'absolute', top:0, left:0, right:0, zIndex:10, padding:'max(env(safe-area-inset-top),14px) 20px 16px', display:'flex', alignItems:'center', justifyContent:'space-between', background:'linear-gradient(to bottom,rgba(0,0,0,0.75),transparent)' }}>
        <div style={{ display:'flex', alignItems:'center', gap:10 }}>
          <div style={{ width:34, height:34, borderRadius:10, background:'linear-gradient(135deg,#c8922a,#8b5e10)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:16, boxShadow:'0 2px 12px rgba(200,146,42,0.4)' }}>🇻🇳</div>
          <div style={{ display:'flex', flexDirection:'column', lineHeight:1 }}>
            <span style={{ fontFamily:"'Playfair Display',serif", fontSize:15, color:'#fff' }}>Translate</span>
            <span style={{ fontSize:9, fontWeight:700, letterSpacing:'0.18em', textTransform:'uppercase', color:'#c8922a', marginTop:2 }}>Vietnamese</span>
          </div>
        </div>
        {/* Mode toggle buttons */}
        <div style={{ display:'flex', background:'rgba(0,0,0,0.5)', border:'1px solid rgba(200,146,42,0.22)', borderRadius:20, padding:3, gap:2, backdropFilter:'blur(12px)' }}>
          {(['tap','auto'] as const).map(m => (
            <button key={m} onClick={() => setMode(m)} style={{
              padding:'5px 16px', borderRadius:16, border:'none',
              background: mode===m ? 'linear-gradient(135deg,#c8922a,#a87520)' : 'transparent',
              color: mode===m ? '#000' : 'rgba(255,255,255,0.45)',
              fontSize:11, fontWeight:700, cursor:'pointer',
              fontFamily:"'Be Vietnam Pro',sans-serif",
              letterSpacing:'0.05em', textTransform:'uppercase', transition:'all .2s',
            }}>{m.charAt(0).toUpperCase() + m.slice(1)}</button>
          ))}
        </div>
      </div>

      {/* Auto badge */}
      {mode === 'auto' && (
        <div style={{ position:'absolute', top:78, left:'50%', transform:'translateX(-50%)', zIndex:10, background:'#c8922a', borderRadius:20, padding:'5px 14px', fontSize:10, fontWeight:700, color:'#000', letterSpacing:'0.1em', textTransform:'uppercase' }}>
          Auto Scanning
        </div>
      )}

      {/* Timer ring */}
      {mode === 'auto' && !arActive && (
        <div style={{ position:'absolute', bottom:108, left:'50%', transform:'translateX(-50%)', zIndex:10 }}>
          <svg width="48" height="48" viewBox="0 0 64 64" style={{ transform:'rotate(-90deg)' }}>
            <circle cx="32" cy="32" r="30" fill="none" stroke="rgba(200,146,42,0.2)" strokeWidth="3" />
            <circle ref={timerCircleRef} cx="32" cy="32" r="30" fill="none" stroke="#c8922a" strokeWidth="3" strokeLinecap="round"
              style={{ strokeDasharray:188, strokeDashoffset:188 }} />
          </svg>
        </div>
      )}

      {/* Tap hint overlay - removed */}

      {/* AR overlay legend */}
      {arActive && (
        <div style={{ position:'absolute', top:76, left:'50%', transform:'translateX(-50%)', zIndex:10, background:'rgba(0,0,0,0.65)', backdropFilter:'blur(10px)', border:'1px solid rgba(200,146,42,0.22)', borderRadius:20, padding:'6px 14px', fontSize:11, color:'rgba(255,255,255,0.6)', whiteSpace:'nowrap', display:'flex', alignItems:'center', gap:8 }}>
          <span style={{ color:'#e8b84b', fontWeight:700 }}>EN</span> overlaid · Tap image to dismiss
        </div>
      )}

      {/* Dismiss hint */}
      {arActive && (
        <div style={{ position:'absolute', bottom:115, left:'50%', transform:'translateX(-50%)', zIndex:10, background:'rgba(0,0,0,0.55)', backdropFilter:'blur(8px)', border:'1px solid rgba(200,146,42,0.22)', borderRadius:'16px', padding:'7px 16px', fontSize:11, color:'rgba(255,255,255,0.6)', whiteSpace:'nowrap' }}>
          Tap the image to return to camera
        </div>
      )}

      {/* Bottom control bar */}
      <div style={{ position:'absolute', bottom:0, left:0, right:0, zIndex:10, padding:'20px 28px max(env(safe-area-inset-bottom),24px)', display:'flex', alignItems:'center', justifyContent:'center', gap:28, background:'linear-gradient(to top,rgba(0,0,0,0.82),transparent)' }}>
        {/* Gallery upload */}
        <label style={{ width:48, height:48, borderRadius:'50%', border:'1px solid rgba(255,255,255,0.15)', background:'rgba(0,0,0,0.35)', color:'white', fontSize:18, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', backdropFilter:'blur(8px)', flexShrink:0 }}>
          🖼️
          <input type="file" accept="image/*" style={{ display:'none' }} onChange={e => handleGallery(e.target.files?.[0])} />
        </label>

        {/* Shutter / capture button */}
        <div onClick={onShutter} style={{ width:72, height:72, borderRadius:'50%', border:`2px solid ${scanning?'#e8b84b': '#c8922a'}`, background:'rgba(0,0,0,0.4)', display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer', backdropFilter:'blur(8px)', boxShadow:scanning?'0 0 30px rgba(232,184,75,0.5)':'0 0 20px rgba(200,146,42,0.3)', transition:'box-shadow .2s,border-color .2s', flexShrink:0 }}>
          <span style={{ fontSize:24 }}>{arActive ? '✕' : scanning ? '⏳' : '📷'}</span>
        </div>

        {/* Flip camera */}
        <button onClick={flipCamera} style={{ width:48, height:48, borderRadius:'50%', border:'1px solid rgba(255,255,255,0.15)', background:'rgba(0,0,0,0.35)', color:'white', fontSize:18, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', backdropFilter:'blur(8px)', flexShrink:0 }}>
          🔄
        </button>
      </div>

      {/* Scanning indicator */}
      {scanning && (
        <div style={{ position:'absolute', top:'50%', left:'50%', transform:'translate(-50%,-50%)', zIndex:15, background:'rgba(0,0,0,0.75)', backdropFilter:'blur(14px)', border:'1px solid rgba(200,146,42,0.22)', borderRadius:20, padding:'14px 24px', display:'flex', alignItems:'center', gap:10, fontSize:13, fontWeight:500 }}>
          <span style={{ width:7, height:7, borderRadius:'50%', background:'#c8922a', display:'inline-block', animation:'pulse 1.1s ease infinite' }} />
          Translating…
        </div>
      )}

      {/* Camera permission/error message */}
      {noCamera && (
        <div style={{ position:'absolute', inset:0, zIndex:5, display:'flex', alignItems:'center', justifyContent:'center', flexDirection:'column', gap:14, textAlign:'center', padding:40, background:'radial-gradient(ellipse at center,#111,#000)' }}>
          <div style={{ fontSize:52 }}>📷</div>
          <p style={{ fontSize:14, color:'rgba(255,255,255,0.55)', lineHeight:1.7 }}>
            Camera access is needed.<br />Please allow permission and try again.
          </p>
          <button onClick={startCamera} style={{ padding:'13px 28px', borderRadius:14, border:'none', background:'linear-gradient(135deg,#c8922a,#8b5e10)', color:'#000', fontSize:14, fontWeight:700, cursor:'pointer', fontFamily:"'Be Vietnam Pro',sans-serif", marginTop:10 }}>
            Enable Camera
          </button>
        </div>
      )}

      <style>{`@keyframes pulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.4;transform:scale(.6)}}`}</style>
    </div>
  );
}
