import type { Pin } from '../types/flow';

function dedent(text: string): string {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const nonEmpty = lines.filter((l) => l.trim().length > 0);
  if (nonEmpty.length === 0) return '';

  const indents = nonEmpty
    .map((l) => l.match(/^\s*/)?.[0].length ?? 0)
    .filter((n) => n > 0);
  const minIndent = indents.length > 0 ? Math.min(...indents) : 0;

  return lines.map((l) => l.slice(minIndent)).join('\n').trimEnd();
}

export function isValidPythonIdentifier(name: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name);
}

export function sanitizePythonIdentifier(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return 'param';

  let out = trimmed.replace(/[^\w]/g, '_');
  if (/^\d/.test(out)) out = `p_${out}`;
  if (!out) out = 'param';
  if (!/^[A-Za-z_]/.test(out)) out = `p_${out}`;
  return out;
}

export function generatePythonTransformCode(params: Pin[], body: string): string {
  const bodyClean = dedent(body).trim();
  const lines: string[] = [];
  lines.push('def transform(_input):');

  const dataPins = params.filter((p) => p.type !== 'execution');
  for (const pin of dataPins) {
    const name = sanitizePythonIdentifier(pin.id);
    lines.push(`    ${name} = _input.get(${JSON.stringify(pin.id)})`);
  }

  if (!bodyClean) {
    lines.push('    return _input');
    lines.push('');
    return lines.join('\n');
  }

  const bodyLines = dedent(body).replace(/\r\n/g, '\n').split('\n');
  for (const line of bodyLines) {
    lines.push(`    ${line}`);
  }
  lines.push('');
  return lines.join('\n');
}

export function extractFunctionBody(code: string, functionName = 'transform'): string | null {
  const lines = code.replace(/\r\n/g, '\n').split('\n');
  const defIndex = lines.findIndex((l) => l.trimStart().startsWith(`def ${functionName}(`));
  if (defIndex === -1) return null;
  const bodyLines = lines.slice(defIndex + 1);
  if (bodyLines.length === 0) return '';
  const stripped = bodyLines.map((l) => (l.startsWith('    ') ? l.slice(4) : l));
  return dedent(stripped.join('\n')).trimEnd();
}

