// render.mjs — the canonical review-findings schema (so every provider is asked for the SAME shape)
// plus small text formatters. Kept provider-agnostic; adapters translate it to their native flag.
export const REVIEW_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['findings'],
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['file', 'severity', 'summary'],
        properties: {
          file: { type: 'string' },
          line: { type: 'integer' },
          severity: { type: 'string', enum: ['blocker', 'high', 'medium', 'low', 'nit'] },
          summary: { type: 'string' },
        },
      },
    },
  },
};

export function renderFindings(parsed) {
  const list = Array.isArray(parsed?.findings) ? parsed.findings : null;
  if (!list) return null;
  if (!list.length) return '  (the reviewer returned zero findings)';
  return list
    .map((f) => `  [${f.severity || '?'}] ${f.file || '?'}${f.line ? `:${f.line}` : ''} — ${f.summary || ''}`)
    .join('\n');
}
