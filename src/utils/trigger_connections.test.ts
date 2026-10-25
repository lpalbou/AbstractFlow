import { describe, expect, it, vi } from 'vitest';
import { GatewayHttpError } from './gatewayClient';
import {
  AutomationDefaultsError,
  assertValidAutomationDefaults,
  describeAutomationDefaults,
  parseAutomationDefaults,
} from './triggerBindings';
import {
  TRIGGER_CONNECTIONS_ENDPOINT,
  TriggerConnectionsContractError,
  connectionOptionLabel,
  connectionProblem,
  connectionsForSource,
  consoleNewConnectionUrl,
  fetchTriggerConnections,
  parseTriggerConnectionsResponse,
} from './triggerConnections';
import { TriggerSourcesContractError, parseTriggerSourceItem, parseTriggerSourcesResponse, type AvailableTriggerSource } from './triggerSources';
import { CONNECTIONS_RESPONSE, FEED_ITEM_V1, TRIGGER_SOURCES_RESPONSE } from './triggerSources.fixtures';

const SOURCES = parseTriggerSourcesResponse({ items: [...TRIGGER_SOURCES_RESPONSE.items, FEED_ITEM_V1] });
const FEED = SOURCES.find((s): s is AvailableTriggerSource => s.id === 'feed.item' && s.available)!;
const SCHEDULE = SOURCES.find((s): s is AvailableTriggerSource => s.id === 'schedule' && s.available)!;

describe('trigger-source descriptors: needs_connection + connection_schema', () => {
  it('parses the flag and the connection schema', () => {
    expect(FEED.needs_connection).toBe(true);
    expect(FEED.connection_schema).toEqual(FEED_ITEM_V1.connection_schema);
  });

  it('reads a descriptor from a gateway before connections as needing none', () => {
    expect(SCHEDULE.needs_connection).toBe(false);
    expect(SCHEDULE.connection_schema).toEqual({});
  });

  it('refuses a flag that is not a boolean, and a connection source without a schema', () => {
    expect(() => parseTriggerSourceItem({ ...FEED_ITEM_V1, needs_connection: 'yes' })).toThrow(TriggerSourcesContractError);
    const { connection_schema: _drop, ...noSchema } = FEED_ITEM_V1;
    expect(() => parseTriggerSourceItem(noSchema)).toThrow(/connection_schema is not an object/);
  });
});

describe('trigger connections client', () => {
  it('fetches the contract route and parses the rows', async () => {
    const fetchJson = vi.fn(async () => CONNECTIONS_RESPONSE);
    const result = await fetchTriggerConnections(fetchJson);
    expect(fetchJson).toHaveBeenCalledWith(TRIGGER_CONNECTIONS_ENDPOINT);
    expect(TRIGGER_CONNECTIONS_ENDPOINT).toBe('api/gateway/triggers/connections');
    if (result.status !== 'ok') throw new Error('expected ok');
    expect(result.connections.map((c) => c.connection_id)).toEqual(['conn_feed1', 'conn_feed2', 'conn_hook1']);
    expect(result.connections[1].last_event_at).toBeNull();
  });

  it('says unavailable on a gateway without the route (404), throws on anything else', async () => {
    const notFound = await fetchTriggerConnections(async () => {
      throw new GatewayHttpError('HTTP 404', 404, { detail: 'Not Found' });
    });
    expect(notFound.status).toBe('unavailable');
    await expect(
      fetchTriggerConnections(async () => {
        throw new GatewayHttpError('HTTP 500', 500, {});
      })
    ).rejects.toBeInstanceOf(GatewayHttpError);
    await expect(fetchTriggerConnections(async () => ({ items: [] }))).rejects.toBeInstanceOf(TriggerConnectionsContractError);
  });

  it('refuses rows that break the contract', () => {
    expect(() => parseTriggerConnectionsResponse({ connections: [{ connection_id: '', source_id: 'x', source_version: 1, status: 'active' }] })).toThrow(/connection_id/);
    expect(() => parseTriggerConnectionsResponse({ connections: [{ connection_id: 'c', source_id: 'x', source_version: 0, status: 'active' }] })).toThrow(/source_version/);
  });

  it('filters by source version, labels, and checks ownership', () => {
    const rows = parseTriggerConnectionsResponse(CONNECTIONS_RESPONSE);
    const feed = connectionsForSource(rows, FEED);
    expect(feed.map((c) => c.connection_id)).toEqual(['conn_feed1', 'conn_feed2']);
    expect(feed.map(connectionOptionLabel)).toEqual(['Release notes feed', 'Old blog · paused']);
    expect(connectionProblem('conn_feed1', rows, FEED)).toBeNull();
    expect(connectionProblem(undefined, rows, FEED)).toBe('choose a connection');
    expect(connectionProblem('conn_hook1', rows, FEED)).toMatch(/belongs to webhook.received v1/);
    expect(connectionProblem('conn_bob', rows, FEED)).toMatch(/not one of yours/);
  });

  it('links to the console Triggers page on that source', () => {
    expect(consoleNewConnectionUrl('http://127.0.0.1:8080/', 'feed.item')).toBe('http://127.0.0.1:8080/console#triggers?new=feed.item');
    expect(() => consoleNewConnectionUrl('', 'feed.item')).toThrow();
  });
});

describe('automation_defaults.trigger.connection_id', () => {
  const draft = (trigger: Record<string, unknown>) => ({
    schema_version: 1,
    trigger: { source_id: 'feed.item', source_version: 1, config: {}, ...trigger },
    context: { mode: 'independent' },
    input_data: {},
  });

  it('is stored and round-trips', () => {
    const parsed = assertValidAutomationDefaults(draft({ connection_id: 'conn_feed1' }), SOURCES);
    expect(parsed.trigger).toEqual({ source_id: 'feed.item', source_version: 1, config: {}, connection_id: 'conn_feed1' });
    expect(describeAutomationDefaults(parsed, SOURCES)).toBe('Feed item v1 · with a connection');
  });

  it('is required by a source that needs a connection, refused by one that does not', () => {
    expect(() => assertValidAutomationDefaults(draft({}), SOURCES)).toThrow(AutomationDefaultsError);
    try {
      assertValidAutomationDefaults(draft({}), SOURCES);
    } catch (e) {
      expect((e as AutomationDefaultsError).issues).toEqual([
        { field: 'trigger.connection_id', message: 'trigger source "feed.item" listens to a connection: choose one' },
      ]);
    }
    const schedule = { ...draft({ connection_id: 'conn_feed1' }), trigger: { source_id: 'schedule', source_version: 1, config: {}, connection_id: 'conn_feed1' } };
    expect(() => assertValidAutomationDefaults(schedule, SOURCES)).toThrow(/takes no connection/);
  });

  it('must be a non-empty string', () => {
    expect(() => parseAutomationDefaults(draft({ connection_id: '' }))).toThrow(/trigger.connection_id: must be a non-empty string/);
    expect(() => parseAutomationDefaults(draft({ connection_id: 7 }))).toThrow(/trigger.connection_id/);
  });
});

describe('mailbox-backed sources (connection_provider: email_accounts)', () => {
  const EMAIL = {
    id: 'email.received',
    version: 1,
    label: 'When an email arrives',
    config_schema: { type: 'object', properties: { account: { type: 'string', default: 'self' } } },
    event_schema: { type: 'object' },
    capabilities: { kind: 'event' },
    needs_connection: true,
    connection_provider: 'email_accounts',
    connection_schema: { type: 'object', properties: { account: { type: 'string' } } },
    available: true,
  };
  const sources = parseTriggerSourcesResponse({ items: [...TRIGGER_SOURCES_RESPONSE.items, FEED_ITEM_V1, EMAIL] });

  it('reads its mailbox from its own settings, never a trigger connection', () => {
    const email = sources.find((s): s is AvailableTriggerSource => s.id === 'email.received' && s.available)!;
    expect(email.needs_connection).toBe(true);
    expect(email.connection_provider).toBe('email_accounts');
    expect(email.uses_trigger_connection).toBe(false);
    expect(FEED.uses_trigger_connection).toBe(true);
    const draft = (trigger: Record<string, unknown>) => ({
      schema_version: 1,
      trigger: { source_id: 'email.received', source_version: 1, config: { account: 'work' }, ...trigger },
      context: { mode: 'independent' },
      input_data: {},
    });
    expect(assertValidAutomationDefaults(draft({}), sources).trigger.config).toEqual({ account: 'work' });
    expect(() => assertValidAutomationDefaults(draft({ connection_id: 'conn_feed1' }), sources)).toThrow(/takes no connection/);
  });

  it('refuses an unknown provider', () => {
    expect(() => parseTriggerSourceItem({ ...EMAIL, connection_provider: 'somewhere' })).toThrow(/connection_provider/);
  });
});
