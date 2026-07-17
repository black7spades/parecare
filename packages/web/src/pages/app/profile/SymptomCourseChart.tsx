import { format } from 'date-fns';
import type { ConditionSymptom } from '../../../lib/care';

/**
 * The course of one condition's symptoms as a single line chart: time
 * across, severity 1 to 10 up, one line per symptom. Replaces the old
 * per-symptom "6 (16 Jul) -> 8 (17 Jul)" text, which stopped being
 * readable after a few readings.
 *
 * Colors come from a validated categorical palette (adjacent-pair
 * colorblind-safe in both light and dark mode); identity is never color
 * alone, since the legend names each line and markers carry native
 * tooltips with the exact value and date.
 */

/** Validated categorical slots; className pairs carry the light and dark step of the same hue. */
const SERIES_CLASSES = [
  'text-[#2a78d6] dark:text-[#3987e5]',
  'text-[#008300] dark:text-[#008300]',
  'text-[#e87ba4] dark:text-[#d55181]',
  'text-[#eda100] dark:text-[#c98500]',
  'text-[#1baf7a] dark:text-[#199e70]',
  'text-[#eb6834] dark:text-[#d95926]',
  'text-[#4a3aa7] dark:text-[#9085e9]',
  'text-[#e34948] dark:text-[#e66767]',
] as const;

const W = 600;
const H = 170;
const PAD = { top: 10, right: 12, bottom: 22, left: 26 };

interface Point {
  t: number;
  severity: number;
}

export function SymptomCourseChart({ symptoms }: { symptoms: ConditionSymptom[] }) {
  // Everything with a history, capped at the palette; the first slots keep
  // their color as symptoms resolve because assignment follows the list
  // order, not the filtered rank.
  const series = symptoms
    .map((s) => ({
      id: s.id,
      name: s.name,
      resolved: !!s.resolved_at,
      points: (s.readings ?? [])
        .map((r) => ({ t: new Date(r.recorded_at).getTime(), severity: r.severity }))
        .sort((a, b) => a.t - b.t) as Point[],
    }))
    .filter((s) => s.points.length > 0);
  const shown = series.slice(0, SERIES_CLASSES.length);
  const totalReadings = shown.reduce((n, s) => n + s.points.length, 0);
  if (shown.length === 0 || totalReadings < 2) return null;

  const times = shown.flatMap((s) => s.points.map((p) => p.t));
  let tMin = Math.min(...times);
  let tMax = Math.max(...times);
  if (tMax === tMin) {
    // A single moment still needs a span to draw on.
    tMin -= 12 * 3600 * 1000;
    tMax += 12 * 3600 * 1000;
  }

  const x = (t: number) => PAD.left + ((t - tMin) / (tMax - tMin)) * (W - PAD.left - PAD.right);
  const y = (v: number) => PAD.top + ((10 - v) / 9) * (H - PAD.top - PAD.bottom);

  return (
    <figure className="mt-3">
      <figcaption className="text-xs text-muted mb-1">Symptom course, severity 1 to 10 over time</figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label="Line chart of symptom severity over time">
        {/* Recessive grid: a line every 2 severity steps */}
        {[2, 4, 6, 8, 10].map((v) => (
          <line key={v} x1={PAD.left} x2={W - PAD.right} y1={y(v)} y2={y(v)} className="stroke-border" strokeWidth="1" />
        ))}
        {[1, 5, 10].map((v) => (
          <text key={v} x={PAD.left - 6} y={y(v) + 3} textAnchor="end" fontSize="10" className="fill-current text-muted">
            {v}
          </text>
        ))}
        <text x={x(tMin)} y={H - 6} textAnchor="start" fontSize="10" className="fill-current text-muted">
          {format(tMin, 'd MMM')}
        </text>
        <text x={x(tMax)} y={H - 6} textAnchor="end" fontSize="10" className="fill-current text-muted">
          {format(tMax, 'd MMM')}
        </text>

        {shown.map((s, i) => (
          <g key={s.id} className={SERIES_CLASSES[i]} opacity={s.resolved ? 0.45 : 1}>
            {s.points.length > 1 ? (
              <polyline
                points={s.points.map((p) => `${x(p.t)},${y(p.severity)}`).join(' ')}
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinejoin="round"
                strokeLinecap="round"
                strokeDasharray={s.resolved ? '4 3' : undefined}
              />
            ) : null}
            {s.points.map((p, j) => (
              <circle key={j} cx={x(p.t)} cy={y(p.severity)} r="4" fill="currentColor" className="stroke-card" strokeWidth="2">
                <title>{`${s.name}: ${p.severity}/10 on ${format(p.t, 'd MMM, HH:mm')}`}</title>
              </circle>
            ))}
          </g>
        ))}
      </svg>
      {shown.length > 1 ? (
        <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
          {shown.map((s, i) => (
            <li key={s.id} className="flex items-center gap-1.5 text-xs text-muted">
              <span aria-hidden className={`inline-block w-2.5 h-2.5 rounded-full bg-current ${SERIES_CLASSES[i]}`} />
              <span className={s.resolved ? 'line-through' : ''}>{s.name}</span>
              {s.resolved ? <span>resolved</span> : null}
            </li>
          ))}
          {series.length > shown.length ? <li className="text-xs text-muted">and {series.length - shown.length} more</li> : null}
        </ul>
      ) : null}
    </figure>
  );
}
