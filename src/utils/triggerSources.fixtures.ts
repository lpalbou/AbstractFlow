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

/**
 * A source that reads from a per-user connection (root backlog 1040/1047):
 * `needs_connection: true` with its `connection_schema`. Kept out of
 * TRIGGER_SOURCES_RESPONSE (whose item list other tests pin).
 */
export const FEED_ITEM_V1 = {
  id: 'feed.item',
  version: 1,
  label: 'Feed item',
  config_schema: {
    type: 'object',
    additionalProperties: false,
    properties: { only_new: { type: 'boolean', title: 'Only new items' } },
  },
  event_schema: { type: 'object' },
  capabilities: { kind: 'event' },
  needs_connection: true,
  connection_schema: {
    type: 'object',
    required: ['url'],
    properties: { url: { type: 'string', title: 'Feed address' } },
  },
  available: true,
};

export const CONNECTIONS_RESPONSE = {
  connections: [
    {
      connection_id: 'conn_feed1',
      source_id: 'feed.item',
      source_version: 1,
      label: 'Release notes feed',
      status: 'active',
      created_at: '2026-10-25T10:00:00Z',
      last_event_at: '2026-10-25T11:57:00Z',
      config_public: { url: 'https://example.org/releases.xml' },
    },
    {
      connection_id: 'conn_feed2',
      source_id: 'feed.item',
      source_version: 1,
      label: 'Old blog',
      status: 'paused',
      created_at: '2026-10-20T10:00:00Z',
      last_event_at: null,
      config_public: {},
    },
    {
      connection_id: 'conn_hook1',
      source_id: 'webhook.received',
      source_version: 1,
      label: 'CI hook',
      status: 'active',
      created_at: '2026-10-25T10:00:00Z',
      last_event_at: null,
      config_public: {},
    },
  ],
};

/**
 * The live runtime descriptors (abstractruntime triggers/, read 2026-10-25):
 * schedule@2 (calendar rules in a time zone), email.received@1 (a mailbox,
 * `connection_provider: email_accounts`, a nested `filter` with string
 * arrays), feed.item@1 / webhook.received@1 (trigger connections, the
 * binding config requires `connection_id`). Tests only.
 */
const SCHEDULE_V1_PROPS = {
  start_at: { type: 'string', format: 'date-time' },
  every: { type: 'string', format: 'duration', pattern: '^[1-9][0-9]*[smhd]$' },
  until: { type: 'string', format: 'date-time' },
  count: { type: 'integer', minimum: 1, maximum: 1000000 },
  anchor: { type: 'string', format: 'date-time' },
};
export const SCHEDULE_V2 = {
  id: 'schedule',
  version: 2,
  label: 'Schedule',
  config_schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      kind: { type: 'string', enum: ['every', 'once', 'daily', 'weekly', 'monthly'] },
      at: { type: 'string', description: "daily/weekly/monthly: 'HH:MM'; once: 'YYYY-MM-DDTHH:MM' (wall time in time_zone)" },
      days: { type: 'array', minItems: 1, uniqueItems: true, items: { type: 'string', enum: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] } },
      day: { oneOf: [{ type: 'integer', minimum: 1, maximum: 31 }, { type: 'string', enum: ['last'] }] },
      time_zone: { type: 'string', description: 'IANA time zone name, e.g. Europe/Paris' },
      ...SCHEDULE_V1_PROPS,
    },
  },
  event_schema: { type: 'object' },
  capabilities: { kind: 'time' },
  needs_connection: false,
  connection_schema: null,
  available: true,
};

export const EMAIL_RECEIVED_V1 = {
  id: 'email.received',
  version: 1,
  label: 'When an email arrives',
  config_schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      account: { type: 'string', default: 'self', pattern: '^[A-Za-z0-9][A-Za-z0-9_.@+-]{0,127}$' },
      folder: { type: 'string', minLength: 1 },
      uses_model: { type: 'boolean' },
      every: { type: 'string', format: 'duration', pattern: '^[1-9][0-9]*[smhd]$' },
      max_batch: { type: 'integer', minimum: 1, maximum: 50 },
      start_at: { type: 'string', format: 'date-time' },
      auto_submitted: { type: 'string', enum: ['skip', 'admit'], default: 'skip' },
      filter: {
        type: 'object',
        additionalProperties: false,
        properties: {
          from_in: { type: 'array', items: { type: 'string', format: 'email' } },
          from_domain_in: { type: 'array', items: { type: 'string' } },
          to_in: { type: 'array', items: { type: 'string', format: 'email' } },
          subject_contains: { type: 'string', maxLength: 200 },
          has_attachment: { type: 'boolean' },
        },
      },
    },
  },
  event_schema: { type: 'object' },
  capabilities: { kind: 'event' },
  needs_connection: true,
  connection_provider: 'email_accounts',
  connection_schema: { type: 'object', properties: { account: { type: 'string' } } },
  available: true,
};

const CONNECTION_BINDING_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['connection_id'],
  properties: {
    connection_id: { type: 'string', minLength: 1, maxLength: 64 },
    max_batch: { type: 'integer', minimum: 1, maximum: 50, default: 20 },
    start_at: { type: 'string', format: 'date-time' },
  },
};

export const FEED_ITEM_LIVE = {
  id: 'feed.item',
  version: 1,
  label: 'When a feed has a new item',
  config_schema: CONNECTION_BINDING_SCHEMA,
  event_schema: { type: 'object' },
  capabilities: { kind: 'event' },
  needs_connection: true,
  connection_provider: 'trigger_connections',
  connection_schema: { type: 'object', required: ['url'], properties: { url: { type: 'string', format: 'uri' } } },
  available: true,
};

export const WEBHOOK_V1 = {
  id: 'webhook.received',
  version: 1,
  label: 'When a webhook is called',
  config_schema: CONNECTION_BINDING_SCHEMA,
  event_schema: { type: 'object' },
  capabilities: { kind: 'event' },
  needs_connection: true,
  connection_provider: 'trigger_connections',
  connection_schema: { type: 'object', properties: { subject_path: { type: 'string' } } },
  available: true,
};

export const LIVE_SOURCES_RESPONSE = {
  items: [SCHEDULE_V1, SCHEDULE_V2, MANUAL_V1, EMAIL_RECEIVED_V1, FEED_ITEM_LIVE, WEBHOOK_V1],
};

/** `GET /api/gateway/me/email` (the parts Flow reads). */
export const ME_EMAIL_RESPONSE = {
  configured: true,
  address: 'test@abstractframework.ai',
  accounts: [
    { account_id: 'work', primary: false, account_ref: 'work', configured: true, address: 'work@example.org', can_read: true, can_send: false, enabled: true },
    { account_id: 'default', primary: true, account_ref: 'default', configured: true, address: 'test@abstractframework.ai', can_read: true, can_send: true, enabled: true },
    { account_id: 'outbox', primary: false, account_ref: 'outbox', configured: true, address: 'send-only@example.org', can_read: false, can_send: true, enabled: true },
  ],
};
