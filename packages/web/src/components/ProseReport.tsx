/**
 * Renders a care plan prose report: plain text with a light markdown
 * subset ('###' headers, '####' subheaders, '*' bullets, '**bold**'
 * runs). The first four lines are the title block (Care Plan, name,
 * version, date) and render as the document masthead.
 */

function Inline({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*)/).filter((p) => p.length > 0);
  return (
    <>
      {parts.map((part, i) =>
        part.startsWith('**') && part.endsWith('**') ? (
          <strong key={i} className="font-semibold text-ink">
            {part.slice(2, -2)}
          </strong>
        ) : (
          <span key={i}>{part}</span>
        )
      )}
    </>
  );
}

export function ProseReport({ report }: { report: string }) {
  const lines = report.split('\n');
  const blocks: React.ReactNode[] = [];
  let bullets: string[] = [];
  let key = 0;

  const flushBullets = () => {
    if (bullets.length === 0) return;
    blocks.push(
      <ul key={key++} className="list-disc pl-5 space-y-1 text-sm text-ink">
        {bullets.map((b, i) => (
          <li key={i}>
            <Inline text={b} />
          </li>
        ))}
      </ul>
    );
    bullets = [];
  };

  lines.forEach((raw, i) => {
    const line = raw.trimEnd();
    if (line.startsWith('* ') || line.startsWith('- ')) {
      bullets.push(line.slice(2));
      return;
    }
    flushBullets();
    if (line.startsWith('#### ')) {
      blocks.push(
        <h4 key={key++} className="text-sm font-semibold text-ink pt-2">
          {line.slice(5)}
        </h4>
      );
    } else if (line.startsWith('### ')) {
      blocks.push(
        <h3 key={key++} className="text-sm font-semibold text-ink pt-3 border-t border-border mt-3">
          {line.slice(4)}
        </h3>
      );
    } else if (line.trim() === '') {
      // paragraph spacing comes from the block gaps
    } else if (i === 0 && line === 'Care Plan') {
      blocks.push(
        <p key={key++} className="text-2xl font-bold text-ink">
          {line}
        </p>
      );
    } else if (i > 0 && i < 4 && !line.startsWith('#')) {
      blocks.push(
        <p key={key++} className="text-sm text-ink">
          {line}
        </p>
      );
    } else {
      blocks.push(
        <p key={key++} className="text-sm text-ink leading-relaxed">
          <Inline text={line} />
        </p>
      );
    }
  });
  flushBullets();

  return <div className="space-y-2">{blocks}</div>;
}
