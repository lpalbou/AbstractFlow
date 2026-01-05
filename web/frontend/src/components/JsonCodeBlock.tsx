import { useMemo } from 'react';
import DOMPurify from 'dompurify';
import clsx from 'clsx';

function tryPrettyJson(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') {
    const s = value.trim();
    // If the string looks like JSON, render it as formatted JSON (best-effort).
    if ((s.startsWith('{') && s.endsWith('}')) || (s.startsWith('[') && s.endsWith(']'))) {
      try {
        const parsed = JSON.parse(s);
        return JSON.stringify(parsed, null, 2);
      } catch {
        return value;
      }
    }
    return value;
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function highlightJsonToHtml(jsonText: string): string {
  const escaped = escapeHtml(jsonText);
  // Classic JSON highlighter: keys/strings/numbers/bools/null.
  return escaped.replace(
    /("(\\u[a-fA-F0-9]{4}|\\[^u]|[^\\"])*"(?:\s*:)?|\btrue\b|\bfalse\b|\bnull\b|-?\d+(?:\.\d+)?(?:[eE][+\-]?\d+)?)/g,
    (m) => {
      let cls = 'number';
      if (m.startsWith('"')) {
        cls = m.endsWith(':') ? 'key' : 'string';
      } else if (m === 'true' || m === 'false') {
        cls = 'boolean';
      } else if (m === 'null') {
        cls = 'null';
      }
      return `<span class="json-token ${cls}">${m}</span>`;
    }
  );
}

export function JsonCodeBlock(props: { value: unknown; className?: string }) {
  const { value, className } = props;
  const pretty = useMemo(() => tryPrettyJson(value), [value]);
  const html = useMemo(() => {
    const raw = highlightJsonToHtml(pretty);
    // We escape all user content before inserting spans; this sanitize is defense-in-depth.
    return DOMPurify.sanitize(raw);
  }, [pretty]);

  return (
    <pre className={clsx('json-codeblock', className)}>
      <code className="json-codeblock__code" dangerouslySetInnerHTML={{ __html: html }} />
    </pre>
  );
}



