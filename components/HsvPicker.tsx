
import React, { useCallback, useRef } from 'react';

interface HsvPickerProps {
  color: string;                    // 当前颜色（hex）
  onChange: (hex: string) => void;  // 变化回调
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  let h = hex.replace('#', '');
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  const n = parseInt(h, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function rgbToHsv(r: number, g: number, b: number): { h: number; s: number; v: number } {
  const rr = r / 255, gg = g / 255, bb = b / 255;
  const max = Math.max(rr, gg, bb), min = Math.min(rr, gg, bb);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === rr) h = ((gg - bb) / d) % 6;
    else if (max === gg) h = (bb - rr) / d + 2;
    else h = (rr - gg) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const s = max === 0 ? 0 : d / max;
  return { h, s, v: max };
}

function hsvToRgb(h: number, s: number, v: number): { r: number; g: number; b: number } {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  let r = 0, g = 0, b = 0;
  if (h < 60) { r = c; g = x; }
  else if (h < 120) { r = x; g = c; }
  else if (h < 180) { g = c; b = x; }
  else if (h < 240) { g = x; b = c; }
  else if (h < 300) { r = x; b = c; }
  else { r = c; b = x; }
  return { r: Math.round((r + m) * 255), g: Math.round((g + m) * 255), b: Math.round((b + m) * 255) };
}

function rgbToHex(r: number, g: number, b: number): string {
  return '#' + [r, g, b].map(x => x.toString(16).padStart(2, '0')).join('');
}

/** 方形 HSV 取色器：饱和度/亮度方块 + 色相条，支持点击/拖拽 */
const HsvPicker: React.FC<HsvPickerProps> = ({ color, onChange }) => {
  const { r, g, b } = hexToRgb(color);
  const hsv = rgbToHsv(r, g, b);
  const hsvRef = useRef(hsv);
  hsvRef.current = hsv;
  const svRef = useRef<HTMLDivElement>(null);
  const hueRef = useRef<HTMLDivElement>(null);

  const applyFromClient = useCallback((clientX: number, clientY: number, mode: 'sv' | 'hue') => {
    const cur = hsvRef.current;
    if (mode === 'sv' && svRef.current) {
      const rect = svRef.current.getBoundingClientRect();
      const x = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      const y = Math.max(0, Math.min(1, (clientY - rect.top) / rect.height));
      const c = hsvToRgb(cur.h, x, 1 - y);
      onChange(rgbToHex(c.r, c.g, c.b));
    } else if (mode === 'hue' && hueRef.current) {
      const rect = hueRef.current.getBoundingClientRect();
      const x = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      // 从黑/白出发拖色相条时自动补饱和度和亮度，否则纯黑/纯白下色相无可见效果
      const c = hsvToRgb(x * 360, cur.s === 0 ? 1 : cur.s, cur.v === 0 ? 1 : cur.v);
      onChange(rgbToHex(c.r, c.g, c.b));
    }
  }, [onChange]);

  const onPointerDown = (mode: 'sv' | 'hue') => (e: React.MouseEvent) => {
    e.preventDefault();
    applyFromClient(e.clientX, e.clientY, mode);
    const onMove = (ev: MouseEvent) => applyFromClient(ev.clientX, ev.clientY, mode);
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.userSelect = '';
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    document.body.style.userSelect = 'none';
  };

  return (
    <div className="space-y-2">
      {/* 饱和度/亮度方块：横轴饱和度，纵轴亮度 */}
      <div
        ref={svRef}
        onMouseDown={onPointerDown('sv')}
        className="relative w-full h-32 rounded cursor-crosshair"
        style={{ background: `linear-gradient(to top, #000, rgba(0,0,0,0)), linear-gradient(to right, #fff, hsl(${hsv.h}, 100%, 50%))` }}
      >
        <div
          className="absolute w-3.5 h-3.5 rounded-full border-2 border-white shadow -translate-x-1/2 -translate-y-1/2 pointer-events-none"
          style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%`, backgroundColor: color }}
        />
      </div>
      {/* 色相条 */}
      <div
        ref={hueRef}
        onMouseDown={onPointerDown('hue')}
        className="relative w-full h-4 rounded cursor-pointer"
        style={{ background: 'linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)' }}
      >
        <div
          className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-1.5 h-5 rounded-sm border border-black/40 bg-white pointer-events-none"
          style={{ left: `${(hsv.h / 360) * 100}%` }}
        />
      </div>
    </div>
  );
};

export default HsvPicker;
