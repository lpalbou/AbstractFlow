/**
 * The `Email` data type (operator wave 2026-10-25: deterministic email
 * handling). One record per message, the runtime's shape (W1's mail effects
 * and the mail trigger's `messages`):
 *
 *   Email = {id (the locator "uidvalidity:uid:folder" the verbs take),
 *            message_id, mailbox, folder, thread_id, from, to, cc, subject,
 *            date, body_text, body_html, attachments[{index, name, size, type,
 *            artifact}], seen, flagged, labels}   (abstractruntime 0.12.0)
 *
 * Pins: `email` (one) and `emails` (a list). An `email` connects to object
 * and any pins, an `emails` list to array and any pins; ForEach over an
 * `emails` list gives an `email` item (utils/relays.ts withLoopItemTypes).
 */
import type { Pin } from '../types/flow';

export const EMAIL_FIELDS = [
  'id',
  'message_id',
  'mailbox',
  'folder',
  'thread_id',
  'from',
  'to',
  'cc',
  'subject',
  'date',
  'body_text',
  'body_html',
  'attachments',
  'seen',
  'flagged',
  'labels',
] as const;
export type EmailField = (typeof EMAIL_FIELDS)[number];

const FIELD_DOCS: Record<EmailField, { type: string; description: string; schema?: Record<string, unknown> }> = {
  id: { type: 'string', description: 'Where the message is (what the mail nodes act on).' },
  message_id: { type: 'string', description: 'The email’s Message-ID.' },
  mailbox: { type: 'string', description: 'The mailbox it is in (its address).' },
  folder: { type: 'string', description: 'The folder it is in (e.g. INBOX).' },
  thread_id: { type: 'string', description: 'The conversation it belongs to.' },
  from: { type: 'string', description: 'Who sent it.' },
  to: { type: 'array', description: 'Who it was sent to.', schema: { type: 'array', items: { type: 'string' } } },
  cc: { type: 'array', description: 'Who was copied.', schema: { type: 'array', items: { type: 'string' } } },
  subject: { type: 'string', description: 'Its subject.' },
  date: { type: 'string', description: 'When it was sent (date and time).' },
  body_text: { type: 'string', description: 'The message as plain text.' },
  body_html: { type: 'string', description: 'The message as HTML, when it has one.' },
  attachments: {
    type: 'array',
    description: 'Its attachments: index, name, size, type (Get attachment reads one by index).',
    schema: { type: 'array', items: { type: 'object', properties: { index: { type: 'integer' }, name: { type: 'string' }, size: { type: 'integer' }, type: { type: 'string' }, artifact: { type: ['object', 'null'] } } } },
  },
  seen: { type: 'boolean', description: 'Whether it was read.' },
  flagged: { type: 'boolean', description: 'Whether it is flagged.' },
  labels: { type: 'array', description: 'Its labels.', schema: { type: 'array', items: { type: 'string' } } },
};

export const EMAIL_SCHEMA: Record<string, unknown> = {
  type: 'object',
  title: 'Email',
  'x-abstract-type': 'email',
  description: 'One email: id, mailbox, folder, thread_id, from, to, cc, subject, date, body_text, body_html, attachments, seen, flagged, labels.',
  properties: Object.fromEntries(
    EMAIL_FIELDS.map((f) => [f, { type: FIELD_DOCS[f].type === 'array' ? 'array' : FIELD_DOCS[f].type, description: FIELD_DOCS[f].description, ...(FIELD_DOCS[f].schema ? { items: (FIELD_DOCS[f].schema as { items: unknown }).items } : {}) }])
  ),
};

export const EMAILS_SCHEMA: Record<string, unknown> = {
  type: 'array',
  title: 'Email list',
  'x-abstract-type': 'emails',
  description: 'A list of emails; each has id, from, to, subject, date, body_text, attachments, seen, flagged, labels…',
  items: EMAIL_SCHEMA,
};

/** One `email` pin (hover lists the fields). */
export function emailPin(id: string, label: string, description: string): Pin {
  return { id, label, type: 'email', description, schema: EMAIL_SCHEMA };
}

/** One `emails` pin. */
export function emailsPin(id: string, label: string, description: string): Pin {
  return { id, label, type: 'emails', description, schema: EMAILS_SCHEMA };
}

/** The "Email fields" accessor's outputs: one pin per field, typed and described. */
export function emailFieldPins(fields: readonly EmailField[] = EMAIL_FIELDS): Pin[] {
  return fields.map((f) => {
    const doc = FIELD_DOCS[f];
    const type = doc.type === 'boolean' ? 'boolean' : doc.type === 'array' ? 'array' : 'string';
    return { id: f, label: f, type, description: doc.description, ...(doc.schema ? { schema: doc.schema } : {}) } as Pin;
  });
}
