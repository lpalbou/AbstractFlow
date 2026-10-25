/**
 * Plain words for the settings of the trigger sources the framework ships
 * (operator 2026-10-25). A source this table does not know still gets a form
 * from its own schema, labelled from its keys ("max_batch" -> "Max batch").
 * `omit` lists the settings another control owns (the mailbox picker, the
 * connection, the schedule editor).
 */
export interface TriggerSettingsCopy {
  /** The "More settings" section's title. */
  title: string;
  labels: Record<string, { label?: string; description?: string }>;
  omit: string[];
  /** The whole config is owned by a dedicated editor: no settings form. */
  noForm?: boolean;
}

const BATCH = { label: 'At most this many per run', description: 'Items that arrive together start one run with all of them, up to this many.' };
const START_AT = { label: 'Start listening from', description: 'A date and time, written like 2026-11-02T08:00:00Z.' };

const EMAIL: TriggerSettingsCopy = {
  title: 'More settings',
  omit: ['account'],
  labels: {
    folder: { label: 'Folder', description: 'The mailbox folder to watch; empty = the inbox.' },
    uses_model: { label: 'The flow uses a model', description: 'Yes (the default): new mail is gathered into one run at most every hour; No: at most every minute.' },
    every: { label: 'Gather new mail into one run every', description: 'Never less than a minute.' },
    max_batch: { label: 'At most this many messages per run', description: 'The rest wait for the next run; nothing is dropped.' },
    start_at: START_AT,
    auto_submitted: { label: 'Automatic messages', description: 'Out-of-office replies, bounces and other machine mail: skipped unless admitted.' },
    filter: { label: 'Only mail that…' },
    'filter.from_in': { label: 'Comes from', description: 'Email addresses, one per line.' },
    'filter.from_domain_in': { label: 'Comes from the domain', description: 'Domains such as example.org, one per line.' },
    'filter.to_in': { label: 'Is sent to', description: 'Email addresses, one per line.' },
    'filter.subject_contains': { label: 'Has in its subject' },
    'filter.has_attachment': { label: 'Has an attachment' },
  },
};

const CONNECTION: TriggerSettingsCopy = {
  title: 'More settings',
  omit: ['connection_id'],
  labels: { max_batch: BATCH, start_at: START_AT },
};

const SCHEDULE: TriggerSettingsCopy = { title: 'More settings', omit: [], labels: {}, noForm: true };

export function triggerSettingsCopy(sourceId: string): TriggerSettingsCopy {
  if (sourceId === 'schedule') return SCHEDULE;
  if (sourceId.startsWith('email')) return EMAIL;
  if (sourceId.startsWith('feed') || sourceId.startsWith('webhook')) return CONNECTION;
  return { title: 'Settings', omit: [], labels: {} };
}

/** Enum values in words ("skip" -> "Skip"). */
export function enumWords(value: unknown): string {
  if (typeof value !== 'string') return JSON.stringify(value);
  return value ? value[0].toUpperCase() + value.slice(1).replace(/_/g, ' ') : '(empty)';
}
