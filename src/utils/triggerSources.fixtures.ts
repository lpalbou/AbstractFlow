/**
 * Test fixtures: a `GET /api/gateway/trigger-sources` answer shaped by
 * contract C. schedule@1 / manual@1 mirror the contract's config rules
 * (`every` = positive integer + [smhd]; timestamps RFC 3339). `fixture_source`
 * is an id no Flow code references: it proves a new runtime adapter needs no
 * Flow change. Tests only.
 */
export const SCHEDULE_V1 = {
  id: 'schedule',
  version: 1,
  label: 'Schedule',
  config_schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      start_at: { type: 'string', format: 'date-time', title: 'Start at', description: 'First tick (UTC). Default: now.' },
      every: { type: 'string', format: 'duration', pattern: '^[1-9][0-9]*[smhd]$', title: 'Every' },
      until: { type: 'string', format: 'date-time', title: 'Until (exclusive)' },
      count: { type: 'integer', minimum: 1, title: 'Count' },
      anchor: { type: 'string', format: 'date-time', title: 'Anchor' },
    },
  },
  event_schema: { type: 'object' },
  capabilities: { kind: 'time' },
  available: true,
};

export const MANUAL_V1 = {
  id: 'manual',
  version: 1,
  label: 'Manual',
  config_schema: { type: 'object', additionalProperties: false, properties: {} },
  event_schema: { type: 'object' },
  capabilities: { kind: 'manual' },
  available: true,
};

export const FIXTURE_SOURCE_V1 = {
  id: 'fixture_source',
  version: 1,
  label: 'Fixture source',
  config_schema: {
    type: 'object',
    required: ['channel'],
    additionalProperties: false,
    properties: {
      channel: { type: 'string', enum: ['alpha', 'beta'] },
      limit: { type: 'integer', minimum: 1, maximum: 10 },
      filter: { type: 'object', properties: { tag: { type: 'string' } } },
    },
  },
  event_schema: { type: 'object' },
  capabilities: { kind: 'event' },
  available: true,
};

export const BROKEN_PLUGIN = {
  id: 'broken_plugin',
  label: 'broken_plugin',
  available: false,
  unavailable_reason: 'entry point failed to import: ModuleNotFoundError: no module named broken',
};

export const TRIGGER_SOURCES_RESPONSE = {
  items: [SCHEDULE_V1, MANUAL_V1, FIXTURE_SOURCE_V1, BROKEN_PLUGIN],
};
