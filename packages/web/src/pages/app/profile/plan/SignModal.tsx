import { useRef } from 'react';
import {  } from 'react-router-dom';
import {  } from '../../../../components/ui/icons';
import {  } from '../../../../components/CatalogueCombo';
import {  } from '../../../../components/ProseReport';
import {  } from '../../../../components/AllergyModal';
import {   
       
    type PlanVersionMeta } from '../../../../lib/care';
import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import {  } from 'date-fns';
import { api } from '../../../../api/client';
import { Button } from '../../../../components/ui/Button';
import { Input } from '../../../../components/ui/Input';
import { Modal } from '../../../../components/ui/Modal';

function SignaturePad({ onChange }: { onChange: (dataUrl: string | null) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const drew = useRef(false);

  const pos = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  return (
    <div>
      <canvas
        ref={canvasRef}
        width={360}
        height={120}
        className="border border-border rounded-md bg-card touch-none w-full"
        aria-label="Draw your signature"
        onPointerDown={(e) => {
          drawing.current = true;
          const ctx = e.currentTarget.getContext('2d');
          if (!ctx) return;
          const p = pos(e);
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
        }}
        onPointerMove={(e) => {
          if (!drawing.current) return;
          const ctx = e.currentTarget.getContext('2d');
          if (!ctx) return;
          const p = pos(e);
          ctx.lineWidth = 2;
          ctx.lineCap = 'round';
          ctx.strokeStyle = '#1a1a1a';
          ctx.lineTo(p.x, p.y);
          ctx.stroke();
          drew.current = true;
        }}
        onPointerUp={(e) => {
          drawing.current = false;
          if (drew.current) onChange(e.currentTarget.toDataURL('image/png'));
        }}
        onPointerLeave={(e) => {
          if (drawing.current && drew.current) onChange(e.currentTarget.toDataURL('image/png'));
          drawing.current = false;
        }}
      />
      <Button
        size="xs"
        variant="ghost"
        className="mt-1"
        onClick={() => {
          const canvas = canvasRef.current;
          const ctx = canvas?.getContext('2d');
          if (canvas && ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
          drew.current = false;
          onChange(null);
        }}
      >
        Clear
      </Button>
    </div>
  );
}

export function SignModal({
  profileId,
  version,
  defaultName,
  onClose,
  onSigned,
}: {
  profileId: string;
  version: PlanVersionMeta;
  defaultName: string;
  onClose: () => void;
  onSigned: () => void;
}) {
  const [name, setName] = useState(defaultName);
  const [consent, setConsent] = useState(false);
  const [image, setImage] = useState<string | null>(null);
  const [error, setError] = useState('');

  const signMutation = useMutation({
    mutationFn: () =>
      api.post(`/care-profiles/${profileId}/plan/versions/${version.id}/sign`, {
        signer_name: name.trim(),
        signature_image: image,
        consent: true,
      }),
    onSuccess: () => {
      onSigned();
      onClose();
    },
    onError: (err) => setError(err instanceof Error ? err.message : 'Could not record the signature.'),
  });

  return (
    <Modal open onClose={onClose} title={`Sign care plan version ${version.version}`}>
      <div className="space-y-4">
        <p className="text-xs text-muted">
          Your signature is bound to this exact version by its integrity hash, with the time, your account,
          and the device it came from. A signed version is locked: later automatic updates wait for
          sign-off instead of publishing themselves.
        </p>
        <Input label="Your full name" value={name} onChange={(e) => setName(e.target.value)} />
        <div>
          <span className="block text-sm font-medium text-ink mb-1">Signature</span>
          <SignaturePad onChange={setImage} />
        </div>
        <label className="flex items-start gap-2 text-sm text-ink">
          <input
            type="checkbox"
            className="h-4 w-4 mt-0.5 rounded border-border text-primary focus:ring-primary"
            checked={consent}
            onChange={(e) => setConsent(e.target.checked)}
          />
          I have reviewed version {version.version} and consent to signing it electronically.
        </label>
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={signMutation.isPending} disabled={!name.trim() || !consent} onClick={() => signMutation.mutate()}>
            Sign
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Reviewer invitations
