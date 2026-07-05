import { useEffect, useRef, useState } from 'react';
import { Modal } from './Modal';
import { Button } from './Button';
import { Avatar, C64_PALETTE, contrastText } from './Avatar';

const CROP = 256; // on-screen crop square
const OUTPUT = 512; // saved image size

/** Drag-to-pan, slider-to-zoom cropper that outputs a square PNG blob. */
function ImageCropper({ file, onCancel, onApply }: { file: File; onCancel: () => void; onApply: (blob: Blob) => void }) {
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [url, setUrl] = useState<string>('');
  const [nat, setNat] = useState<{ w: number; h: number } | null>(null);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);

  useEffect(() => {
    const u = URL.createObjectURL(file);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [file]);

  if (!url) return null;

  const baseScale = nat ? CROP / Math.min(nat.w, nat.h) : 1;
  const effScale = baseScale * zoom;
  const dispW = nat ? nat.w * effScale : CROP;
  const dispH = nat ? nat.h * effScale : CROP;
  const maxX = Math.max(0, (dispW - CROP) / 2);
  const maxY = Math.max(0, (dispH - CROP) / 2);
  const clamp = (v: number, m: number) => Math.max(-m, Math.min(m, v));
  const ox = clamp(offset.x, maxX);
  const oy = clamp(offset.y, maxY);
  const imgLeft = CROP / 2 - dispW / 2 + ox;
  const imgTop = CROP / 2 - dispH / 2 + oy;

  const apply = () => {
    if (!nat || !imgRef.current) return;
    const canvas = document.createElement('canvas');
    canvas.width = OUTPUT;
    canvas.height = OUTPUT;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const sSize = CROP / effScale;
    const sx = (0 - imgLeft) / effScale;
    const sy = (0 - imgTop) / effScale;
    ctx.drawImage(imgRef.current, sx, sy, sSize, sSize, 0, 0, OUTPUT, OUTPUT);
    canvas.toBlob((blob) => blob && onApply(blob), 'image/png');
  };

  return (
    <div className="space-y-3">
      <div
        className="relative mx-auto overflow-hidden rounded-full bg-surface-2 cursor-grab active:cursor-grabbing touch-none select-none"
        style={{ width: CROP, height: CROP }}
        onPointerDown={(e) => {
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
          drag.current = { x: e.clientX, y: e.clientY, ox, oy };
        }}
        onPointerMove={(e) => {
          if (!drag.current) return;
          setOffset({ x: drag.current.ox + (e.clientX - drag.current.x), y: drag.current.oy + (e.clientY - drag.current.y) });
        }}
        onPointerUp={() => (drag.current = null)}
      >
        <img
          ref={imgRef}
          src={url}
          alt="Crop preview"
          draggable={false}
          onLoad={(e) => setNat({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
          style={{ position: 'absolute', left: imgLeft, top: imgTop, width: dispW, height: dispH, maxWidth: 'none' }}
        />
        <div className="pointer-events-none absolute inset-0 rounded-full ring-2 ring-white/70" />
      </div>
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted">Zoom</span>
        <input type="range" min={1} max={3} step={0.01} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} className="flex-1" />
      </div>
      <p className="text-xs text-muted text-center">Drag to reposition, slide to zoom.</p>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onCancel}>Cancel</Button>
        <Button onClick={apply}>Save photo</Button>
      </div>
    </div>
  );
}

export function AvatarEditor({
  open,
  onClose,
  accountId,
  name,
  avatarUrl,
  color,
  fetchPath,
  onSavePhoto,
  onSaveColor,
  onRemovePhoto,
  saving,
}: {
  open: boolean;
  onClose: () => void;
  accountId: string;
  name: string;
  avatarUrl?: string | null;
  color?: string | null;
  fetchPath?: string;
  onSavePhoto: (blob: Blob) => void;
  onSaveColor: (hex: string) => void;
  onRemovePhoto: () => void;
  saving?: boolean;
}) {
  const [tab, setTab] = useState<'photo' | 'colour'>('photo');
  const [file, setFile] = useState<File | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) {
      setFile(null);
      setTab('photo');
    }
  }, [open]);

  const tabClass = (t: string) =>
    `px-3 py-1.5 text-sm rounded-md ${tab === t ? 'bg-primary-50 text-primary font-medium' : 'text-muted hover:text-ink'}`;

  return (
    <Modal open={open} onClose={onClose} title="Edit photo">
      <div className="space-y-4">
        <div className="flex gap-1">
          <button type="button" className={tabClass('photo')} onClick={() => setTab('photo')}>Photo</button>
          <button type="button" className={tabClass('colour')} onClick={() => setTab('colour')}>Colour</button>
        </div>

        {tab === 'photo' ? (
          file ? (
            <ImageCropper file={file} onCancel={() => setFile(null)} onApply={onSavePhoto} />
          ) : (
            <div className="flex flex-col items-center gap-3 py-2">
              <Avatar accountId={accountId} name={name} avatarUrl={avatarUrl} color={color} fetchPath={fetchPath} size={96} />
              <input
                ref={fileInput}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) setFile(f);
                  if (fileInput.current) fileInput.current.value = '';
                }}
              />
              <div className="flex gap-2">
                <Button size="sm" variant="secondary" onClick={() => fileInput.current?.click()} loading={saving}>
                  {avatarUrl ? 'Choose a new photo' : 'Upload a photo'}
                </Button>
                {avatarUrl ? (
                  <Button size="sm" variant="ghost" onClick={onRemovePhoto} loading={saving}>Remove</Button>
                ) : null}
              </div>
              <p className="text-xs text-muted">JPG or PNG, up to 5 MB. You can crop and zoom before saving.</p>
            </div>
          )
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-muted">No photo? Pick a background colour (the classic Commodore 64 palette).</p>
            <div className="grid grid-cols-8 gap-2">
              {C64_PALETTE.map((hex) => (
                <button
                  key={hex}
                  type="button"
                  aria-label={hex}
                  title={hex}
                  onClick={() => onSaveColor(hex)}
                  className={`h-9 w-full rounded-md border border-border transition-transform hover:scale-105 ${color === hex ? 'ring-2 ring-primary' : ''}`}
                  style={{ backgroundColor: hex }}
                >
                  {color === hex ? <span style={{ color: contrastText(hex) }}>✓</span> : null}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
