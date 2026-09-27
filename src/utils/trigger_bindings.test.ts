import { beforeEach, describe, expect, it } from 'vitest';
import type { AutomationDefaults, VisualFlow } from '../types/flow';
import { getNodeTemplate } from '../types/nodes';
import { useFlowStore } from '../hooks/useFlow';
import { automationDefaultsFromPutResponse, updateOpenFlowMetadata } from '../hooks/openFlowMetadata';
import { KNOWN_INTERFACES } from './flowFamilies';
import {
  AutomationDefaultsError,
  assertValidAutomationDefaults,
  configFormFields,
  configFromFormValues,
  draftAutomationDefaults,
  formValuesFromConfig,
  parseAutomationDefaults,
  validateAutomationDefaults,
  validateTriggerConfig,
} from './triggerBindings';
import { parseTriggerSourcesResponse, type AvailableTriggerSource, type JsonSchema } from './triggerSources';
import { TRIGGER_SOURCES_RESPONSE } from './triggerSources.fixtures';

const SOURCES = parseTriggerSourcesResponse(TRIGGER_SOURCES_RESPONSE);
const source = (id: string) => SOURCES.find((s): s is AvailableTriggerSource => s.id === id && s.available)!;
const SCHEDULE = source('schedule');
const MANUAL = source('manual');
const FIXTURE = source('fixture_source');

const fields = (schema: JsonSchema) => configFormFields(schema).map((f) => `${f.key}:${f.kind}`);

describe('schema-driven form → schedule@1 config', () => {
  it('renders the fields from the served schema', () => {
    expect(fields(SCHEDULE.config_schema)).toEqual([
      'start_at:datetime',
      'every:duration',
      'until:datetime',
      'count:integer',
      'anchor:datetime',
    ]);
  });

  it('turns form values into a valid config (empty fields omitted)', () => {
    const { config, issues } = configFromFormValues(SCHEDULE.config_schema, {
      start_at: '2026-09-27T08:00:00Z',
      every: '5',
      'every#unit': 'm',
      count: '12',
      until: '',
    });
    expect(issues).toEqual([]);
    expect(config).toEqual({ start_at: '2026-09-27T08:00:00Z', every: '5m', count: 12 });
    // Editing again reproduces the same values.
    expect(formValuesFromConfig(SCHEDULE.config_schema, config)).toEqual({
      start_at: '2026-09-27T08:00:00Z',
      every: '5',
      'every#unit': 'm',
      count: '12',
    });
  });

  it('rejects cron, weeks, zero and free text for `every`', () => {
    for (const every of ['*/5 * * * *', '1w', '0m', '5 minutes', '5M', '1.5h']) {
      const issues = validateTriggerConfig(SCHEDULE.config_schema, { every });
      expect(issues.map((i) => i.field), every).toEqual(['trigger.config.every']);
    }
    const typed = configFromFormValues(SCHEDULE.config_schema, { every: '*/5 * * * *', 'every#unit': 'm' });
    expect(typed.issues.map((i) => i.field)).toEqual(['trigger.config.every']);
  });

  it('rejects a bad count, a non-RFC 3339 timestamp and unknown keys', () => {
    const issues = validateTriggerConfig(SCHEDULE.config_schema, {
      count: 0,
      start_at: 'tomorrow 8am',
      cron: '0 8 * * *',
    });
    expect(issues.map((i) => i.field).sort()).toEqual([
      'trigger.config.count',
      'trigger.config.cron',
      'trigger.config.start_at',
    ]);
    expect(validateTriggerConfig(SCHEDULE.config_schema, { count: 2.5 })[0].message).toBe('must be an integer');
  });

  it('accepts a one-shot (no `every`) and an empty config (source defaults)', () => {
    expect(validateTriggerConfig(SCHEDULE.config_schema, { start_at: '2026-09-28T00:00:00+02:00' })).toEqual([]);
    expect(validateTriggerConfig(SCHEDULE.config_schema, {})).toEqual([]);
  });
});

describe('schema-driven form → manual@1 config', () => {
  it('has no fields and accepts only {}', () => {
    expect(configFormFields(MANUAL.config_schema)).toEqual([]);
    expect(configFromFormValues(MANUAL.config_schema, {})).toEqual({ config: {}, issues: [] });
    expect(validateTriggerConfig(MANUAL.config_schema, { every: '5m' }).map((i) => i.field)).toEqual([
      'trigger.config.every',
    ]);
  });
});

describe('a source unknown to Flow is bound purely from its descriptor', () => {
  it('renders enum/integer fields and shows unsupported schema features read-only', () => {
    expect(fields(FIXTURE.config_schema)).toEqual(['channel:enum', 'limit:integer', 'filter:readonly']);
    const filter = configFormFields(FIXTURE.config_schema).find((f) => f.key === 'filter')!;
    expect(filter.schema).toEqual({ type: 'object', properties: { tag: { type: 'string' } } });
  });

  it('validates required, enum and bounds from the schema; read-only values are kept', () => {
    const missing = configFromFormValues(FIXTURE.config_schema, { limit: '11' });
    expect(missing.issues.map((i) => i.field).sort()).toEqual(['trigger.config.channel', 'trigger.config.limit']);

    const previous = { channel: 'alpha', filter: { tag: 'x' } };
    const ok = configFromFormValues(
      FIXTURE.config_schema,
      { ...formValuesFromConfig(FIXTURE.config_schema, previous), limit: '3' },
      previous
    );
    expect(ok).toEqual({ config: { channel: 'alpha', limit: 3, filter: { tag: 'x' } }, issues: [] });

    expect(validateTriggerConfig(FIXTURE.config_schema, { channel: 'gamma' })[0].field).toBe('trigger.config.channel');
  });
});

function defaults(overrides: Partial<AutomationDefaults> = {}): AutomationDefaults {
  return {
    schema_version: 1,
    title: 'Memory watch',
    trigger: { source_id: 'schedule', source_version: 1, config: { every: '2m' } },
    context: { mode: 'independent' },
    input_data: { prompt: 'Report this computer memory usage.' },
    ...overrides,
  };
}

describe('validation against the discovered sources', () => {
  it('accepts valid defaults for schedule@1 and manual@1', () => {
    expect(validateAutomationDefaults(defaults(), SOURCES)).toEqual([]);
    expect(validateAutomationDefaults(draftAutomationDefaults(MANUAL), SOURCES)).toEqual([]);
  });

  it('an unknown source is an error, not silence', () => {
    const unknown = defaults({ trigger: { source_id: 'webhook', source_version: 1, config: {} } });
    expect(validateAutomationDefaults(unknown, SOURCES)).toEqual([
      { field: 'trigger.source_id', message: 'trigger source "webhook" is not served by this gateway' },
    ]);
    expect(() => assertValidAutomationDefaults(unknown, SOURCES)).toThrow(AutomationDefaultsError);
    // No sources discovered = nothing can validate.
    expect(validateAutomationDefaults(defaults(), [])).toHaveLength(1);
  });

  it('an unavailable source and a stale version are errors', () => {
    const broken = defaults({ trigger: { source_id: 'broken_plugin', source_version: 1, config: {} } });
    expect(validateAutomationDefaults(broken, SOURCES)[0].message).toContain('is unavailable: entry point failed');
    const stale = defaults({ trigger: { source_id: 'schedule', source_version: 2, config: {} } });
    expect(validateAutomationDefaults(stale, SOURCES)).toEqual([
      { field: 'trigger.source_version', message: 'trigger source "schedule" version 2 is not served (served: 1)' },
    ]);
  });

  it('a config that breaks the source schema is an error', () => {
    const cron = defaults({ trigger: { source_id: 'schedule', source_version: 1, config: { every: '0 */2 * * *' } } });
    expect(() => assertValidAutomationDefaults(cron, SOURCES)).toThrow(/trigger.config.every/);
  });
});

describe('parseAutomationDefaults (document field shape)', () => {
  it('fills the contract defaults and drops an empty title', () => {
    expect(
      parseAutomationDefaults({
        schema_version: 1,
        title: '  ',
        trigger: { source_id: 'manual', source_version: 1, config: {} },
      })
    ).toEqual({
      schema_version: 1,
      trigger: { source_id: 'manual', source_version: 1, config: {} },
      context: { mode: 'independent' },
      input_data: {},
    });
  });

  it('rejects server-owned ids and any unknown field', () => {
    const withIds = {
      ...defaults(),
      binding_id: '0f8fad5b-d9cb-469f-a165-70867728950e',
      trigger: { ...defaults().trigger, binding_id: '0f8fad5b-d9cb-469f-a165-70867728950e' },
      context: { mode: 'growing', summary: true },
    };
    try {
      parseAutomationDefaults(withIds);
      throw new Error('expected a rejection');
    } catch (error) {
      expect(error).toBeInstanceOf(AutomationDefaultsError);
      expect((error as AutomationDefaultsError).issues.map((i) => i.field).sort()).toEqual([
        'binding_id',
        'context.summary',
        'trigger.binding_id',
      ]);
    }
  });

  it('rejects a wrong schema_version, context mode or input_data', () => {
    expect(() => parseAutomationDefaults({ ...defaults(), schema_version: 2 })).toThrow('schema_version');
    expect(() => parseAutomationDefaults({ ...defaults(), context: { mode: 'shared' } })).toThrow('context.mode');
    expect(() => parseAutomationDefaults({ ...defaults(), input_data: 'hello' })).toThrow('input_data');
  });
});

function flowDocument(automation_defaults?: AutomationDefaults): VisualFlow {
  return {
    id: 'flow-auto',
    name: 'Market watch',
    interfaces: ['abstractcode.agent.v1'],
    nodes: [
      {
        id: 'start',
        type: 'on_flow_start',
        position: { x: 0, y: 0 },
        data: {
          nodeType: 'on_flow_start',
          label: 'On Flow Start',
          icon: '',
          headerColor: '',
          inputs: [],
          outputs: [{ id: 'exec-out', label: '', type: 'execution' }],
        },
      },
    ],
    edges: [],
    ...(automation_defaults ? { automation_defaults } : {}),
  } as VisualFlow;
}

describe('automation_defaults round-trips through the flow document', () => {
  beforeEach(() => useFlowStore.getState().clearFlow());

  it('load → save carries the field unchanged (and through JSON)', () => {
    const value = defaults({
      title: 'Trade value every 5 minutes',
      trigger: { source_id: 'schedule', source_version: 1, config: { every: '5m', start_at: '2026-09-27T08:00:00Z' } },
      context: { mode: 'growing' },
      input_data: { prompt: 'Search the current trade value of ACME shares.' },
    });
    const stored = JSON.parse(JSON.stringify(flowDocument(value))) as VisualFlow;
    const loaded = useFlowStore.getState().loadFlow(stored);
    expect(loaded.automation_defaults).toEqual(value);

    const saved = useFlowStore.getState().getFlow();
    expect(saved.automation_defaults).toEqual(value);
    expect(parseAutomationDefaults(JSON.parse(JSON.stringify(saved)).automation_defaults)).toEqual(value);
    expect(assertValidAutomationDefaults(saved.automation_defaults, SOURCES)).toEqual(value);

    // The store holds its own copy: mutating the source document changes nothing.
    stored.automation_defaults!.trigger.config.every = '1d';
    expect(useFlowStore.getState().getFlow().automation_defaults?.trigger.config.every).toBe('5m');
  });

  it('a flow without defaults saves without the field; clearFlow drops them', () => {
    useFlowStore.getState().loadFlow(flowDocument());
    expect('automation_defaults' in useFlowStore.getState().getFlow()).toBe(false);

    useFlowStore.getState().loadFlow(flowDocument(defaults()));
    useFlowStore.getState().clearFlow();
    expect('automation_defaults' in useFlowStore.getState().getFlow()).toBe(false);
  });

  it('a metadata PUT applies the stored defaults to the open flow, and null removes them', async () => {
    useFlowStore.getState().loadFlow(flowDocument());
    const next = defaults();
    const put = await updateOpenFlowMetadata({
      id: 'flow-auto',
      hasUnsavedChanges: false,
      request: async () => flowDocument(next),
      patchFrom: (updated) => ({ automation_defaults: automationDefaultsFromPutResponse(updated, next) }),
    });
    expect(put.applied).toBe(true);
    expect(put.baseline?.automation_defaults).toEqual(next);
    expect(useFlowStore.getState().getFlow().automation_defaults).toEqual(next);

    const cleared = await updateOpenFlowMetadata({
      id: 'flow-auto',
      hasUnsavedChanges: false,
      request: async () => flowDocument(),
      patchFrom: (updated) => ({ automation_defaults: automationDefaultsFromPutResponse(updated, null) }),
    });
    expect(cleared.baseline && 'automation_defaults' in cleared.baseline).toBe(false);
    expect('automation_defaults' in useFlowStore.getState().getFlow()).toBe(false);
  });

  it('a gateway that does not store the field fails loudly', () => {
    expect(() => automationDefaultsFromPutResponse(flowDocument(), defaults())).toThrow(
      'without storing them'
    );
    expect(() => automationDefaultsFromPutResponse(flowDocument(defaults()), null)).toThrow('asked to clear');
  });
});

describe('contract C12: no trigger pin in v1', () => {
  it('declares no triggerable interface and no `trigger` pin on On Flow Start', () => {
    expect(KNOWN_INTERFACES.some((iface) => iface.id.includes('triggerable'))).toBe(false);
    expect(getNodeTemplate('on_flow_start')?.outputs.map((p) => p.id)).toEqual(['exec-out']);
  });
});
