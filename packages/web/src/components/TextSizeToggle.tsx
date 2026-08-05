import { useState } from 'react';
import { getTextSize, setTextSize, type TextSize } from '../lib/comfort';

const ORDER: TextSize[] = ['default', 'large', 'larger'];
const LABELS: Record<TextSize, string> = {
  default: 'Text: standard',
  large: 'Text: large',
  larger: 'Text: larger',
};

/** Cycles the text size: standard → large → larger, and back. */
export function TextSizeToggle() {
  const [size, setLocal] = useState<TextSize>(getTextSize);

  function cycle() {
    const next = ORDER[(ORDER.indexOf(size) + 1) % ORDER.length];
    setTextSize(next);
    setLocal(next);
  }

  return (
    <button
      type="button"
      onClick={cycle}
      title="Make the text bigger or smaller"
      className="text-xs text-muted hover:text-ink transition-colors"
    >
      {LABELS[size]}
    </button>
  );
}
