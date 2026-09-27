/**
 * "Automation defaults" editor for one flow (Flow Library > Automation).
 *
 * The trigger sources come from the gateway (utils/triggerSources.ts); the
 * config form is rendered from the chosen source's `config_schema`
 * (utils/triggerBindings.ts). Nothing here knows schedule@1 or manual@1.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { AutomationContextMode, AutomationDefaults, JsonValue, VisualFlow } from '../types/flow';
import type { GatewayContracts } from '../utils/gatewayClient';
import { fetchGatewayConnection } from './GatewayConnectionModal';
import {
  triggerSourceCache,
  type AvailableTriggerSource,
  type TriggerSourcesResult,
} from '../utils/triggerSources';
import {
  AUTOMATION_CONTEXT_MODES,
  AUTOMATION_DEFAULTS_SCHEMA_VERSION,
  DURATION_UNITS,
  assertValidAutomationDefaults,
  configFormFields,
  configFromFormValues,
  formValuesFromConfig,
  unsupportedSchemaKeywords,
  AutomationDefaultsError,
  type AutomationDefaultsIssue,
  type ConfigFormField,
  type ConfigFormValues,
} from '../utils/triggerBindings';

export interface AutomationDefaultsModalProps {
  flow: VisualFlow;
  gatewayContracts: GatewayContracts | null;
  onClose: () => void;
  onSave: (next: AutomationDefaults | null) => Promise<void> | void;
}

const CONTEXT_LABELS: Record<AutomationContextMode, string> = {
  independent: 'Independent: every run starts fresh',
  growing: 'Growing: every run continues the same conversation',
};

function startPinNames(flow: VisualFlow): string[] {
  const start = flow.nodes.find((n) => n.type === 'on_flow_start');
  const outputs = (start?.data?.outputs || []) as Array<{ id: string; type?: string }>;
  return outputs.filter((pin) => pin.type !== 'execution').map((pin) => pin.id);
}

function ConfigField({
  field,
  values,
  onChange,
  current,
}: {
  field: ConfigFormField;
  values: ConfigFormValues;
  onChange: (key: string, value: string) => void;
  current: Record<string, JsonValue>;
}) {
  const value = values[field.key] ?? '';
  const label = `${field.label}${field.required ? ' *' : ''}`;
  let control: JSX.Element;
  switch (field.kind) {
    case 'duration':
      control = (
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            className="run-form-input"
            type="number"
            min={1}
            step={1}
            value={value}
            onChange={(e) => onChange(field.key, e.target.value)}
            aria-label={`${field.label} amount`}
          />
          <select
            className="run-form-select"
            value={values[`${field.key}#unit`] ?? ''}
            onChange={(e) => onChange(`${field.key}#unit`, e.target.value)}
            aria-label={`${field.label} unit`}
          >
            {DURATION_UNITS.map((u) => (
              <option key={u} value={u}>
                {{ s: 'seconds', m: 'minutes', h: 'hours', d: 'days' }[u]}
              </option>
            ))}
          </select>
        </div>
      );
      break;
    case 'enum':
      control = (
        <select className="run-form-select" value={value} onChange={(e) => onChange(field.key, e.target.value)}>
          <option value="">(not set)</option>
          {(field.options || []).map((opt) => (
            <option key={JSON.stringify(opt)} value={JSON.stringify(opt)}>
              {typeof opt === 'string' ? opt : JSON.stringify(opt)}
            </option>
          ))}
        </select>
      );
      break;
    case 'boolean':
      control = (
        <select className="run-form-select" value={value} onChange={(e) => onChange(field.key, e.target.value)}>
          <option value="">(not set)</option>
          <option value="true">true</option>
          <option value="false">false</option>
        </select>
      );
      break;
    case 'integer':
    case 'number':
      control = (
        <input
          className="run-form-input"
          type="number"
          step={field.kind === 'integer' ? 1 : 'any'}
          value={value}
          onChange={(e) => onChange(field.key, e.target.value)}
        />
      );
      break;
    case 'readonly':
      control = (
        <pre className="property-hint" style={{ whiteSpace: 'pre-wrap', margin: 0 }}>
          {`Not editable here. Schema: ${JSON.stringify(field.schema)}\nValue: ${
            current[field.key] === undefined ? '(not set)' : JSON.stringify(current[field.key])
          }`}
        </pre>
      );
      break;
    default:
      control = (
        <input
          className="run-form-input"
          type="text"
          value={value}
          placeholder={field.kind === 'datetime' ? '2026-09-27T08:00:00Z (UTC)' : ''}
          onChange={(e) => onChange(field.key, e.target.value)}
        />
      );
  }
  return (
    <div className="run-form-field" style={{ marginTop: 10 }}>
      <label className="run-form-label">{label}</label>
      {control}
      {field.description ? <span className="property-hint">{field.description}</span> : null}
    </div>
  );
}

export function AutomationDefaultsModal({ flow, gatewayContracts, onClose, onSave }: AutomationDefaultsModalProps) {
  const existing = flow.automation_defaults || null;
  const [discovery, setDiscovery] = useState<TriggerSourcesResult | null>(null);
  const [discoveryError, setDiscoveryError] = useState('');
  const [loading, setLoading] = useState(true);
  const [sourceKey, setSourceKey] = useState(
    existing ? `${existing.trigger.source_id}@${existing.trigger.source_version}` : ''
  );
  const [values, setValues] = useState<ConfigFormValues>({});
  const [mode, setMode] = useState<AutomationContextMode>(existing?.context?.mode || 'independent');
  const [title, setTitle] = useState(existing?.title || '');
  const [inputDataText, setInputDataText] = useState(JSON.stringify(existing?.input_data || {}, null, 2));
  const [issues, setIssues] = useState<AutomationDefaultsIssue[]>([]);
  const [saving, setSaving] = useState(false);

  const load = useCallback(
    async (refresh: boolean) => {
      setLoading(true);
      setDiscoveryError('');
      try {
        const connection = await fetchGatewayConnection();
        const result = await triggerSourceCache.load(connection.gateway_url, gatewayContracts, { refresh });
        setDiscovery(result);
      } catch (error) {
        setDiscovery(null);
        setDiscoveryError(error instanceof Error ? error.message : String(error));
      } finally {
        setLoading(false);
      }
    },
    [gatewayContracts]
  );

  useEffect(() => {
    void load(false);
  }, [load]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !saving) onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose, saving]);

  const items = discovery?.status === 'ok' ? discovery.items : [];
  const selected = useMemo(
    () =>
      items.find((s): s is AvailableTriggerSource => s.available && `${s.id}@${s.version}` === sourceKey) || null,
    [items, sourceKey]
  );
  // A schema the editor cannot fully check makes the source unbindable here.
  const unsupported = useMemo(() => (selected ? unsupportedSchemaKeywords(selected.config_schema) : []), [selected]);
  const fields = useMemo(
    () => (selected && !unsupported.length ? configFormFields(selected.config_schema) : []),
    [selected, unsupported]
  );
  const currentConfig = useMemo(
    () =>
      existing && selected && existing.trigger.source_id === selected.id && existing.trigger.source_version === selected.version
        ? existing.trigger.config
        : {},
    [existing, selected]
  );

  // Seed the form from the saved config when its source is (re)selected.
  useEffect(() => {
    if (!selected) {
      setValues({});
      return;
    }
    const seeded = formValuesFromConfig(selected.config_schema, currentConfig);
    for (const field of configFormFields(selected.config_schema)) {
      if (field.kind === 'duration' && !seeded[`${field.key}#unit`]) seeded[`${field.key}#unit`] = 'm';
    }
    setValues(seeded);
  }, [selected, currentConfig]);

  const savedSourceMissing =
    existing && discovery?.status === 'ok' && !selected && sourceKey === `${existing.trigger.source_id}@${existing.trigger.source_version}`;

  const handleSave = async () => {
    if (!selected || unsupported.length || discovery?.status !== 'ok') return;
    const found: AutomationDefaultsIssue[] = [];
    let inputData: unknown;
    try {
      inputData = JSON.parse(inputDataText.trim() || '{}');
    } catch (error) {
      found.push({ field: 'input_data', message: `is not valid JSON (${error instanceof Error ? error.message : String(error)})` });
    }
    const { config, issues: configIssues } = configFromFormValues(selected.config_schema, values, currentConfig);
    found.push(...configIssues);
    if (found.length) {
      setIssues(found);
      return;
    }
    let next: AutomationDefaults;
    try {
      next = assertValidAutomationDefaults(
        {
          schema_version: AUTOMATION_DEFAULTS_SCHEMA_VERSION,
          ...(title.trim() ? { title: title.trim() } : {}),
          trigger: { source_id: selected.id, source_version: selected.version, config },
          context: { mode },
          input_data: inputData,
        },
        discovery.items
      );
    } catch (error) {
      if (error instanceof AutomationDefaultsError) {
        setIssues(error.issues);
        return;
      }
      throw error;
    }
    setIssues([]);
    setSaving(true);
    try {
      await onSave(next);
      onClose();
    } catch (error) {
      setIssues([{ field: '', message: error instanceof Error ? error.message : String(error) }]);
    } finally {
      setSaving(false);
    }
  };

  const handleRemove = async () => {
    setSaving(true);
    try {
      await onSave(null);
      onClose();
    } catch (error) {
      setIssues([{ field: '', message: error instanceof Error ? error.message : String(error) }]);
    } finally {
      setSaving(false);
    }
  };

  const pins = startPinNames(flow);

  return (
    <div className="modal-overlay" onClick={onClose} role="presentation">
      <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Automation defaults">
        <h3>Automation defaults</h3>
        <p className="property-hint">
          What an automation created from <strong>{flow.name}</strong> starts with: its trigger, context and inputs.
          Saved in the flow and published with it; creating the automation happens in AbstractObserver or the
          Assistant. Schedules are fixed UTC intervals.
        </p>

        {loading ? <div className="property-hint">Loading trigger sources from the gateway…</div> : null}
        {discoveryError ? (
          <div className="property-hint" style={{ color: 'var(--error, #e74c3c)' }}>
            Trigger-source discovery failed: {discoveryError}
          </div>
        ) : null}
        {discovery?.status === 'unavailable' ? (
          <div className="property-hint" style={{ color: 'var(--warning)' }}>
            {discovery.reason}
          </div>
        ) : null}

        {discovery?.status === 'ok' ? (
          <>
            <div className="run-form-field" style={{ marginTop: 12 }}>
              <label className="run-form-label">Trigger</label>
              <select className="run-form-select" value={sourceKey} onChange={(e) => setSourceKey(e.target.value)}>
                <option value="">Choose a trigger source…</option>
                {items.map((s) =>
                  s.available ? (
                    <option key={`${s.id}@${s.version}`} value={`${s.id}@${s.version}`}>
                      {s.label} ({s.id} v{s.version})
                    </option>
                  ) : (
                    <option key={`${s.id}@${s.version ?? '?'}`} value="" disabled>
                      {s.label} — unavailable: {s.unavailable_reason}
                    </option>
                  )
                )}
              </select>
              {savedSourceMissing ? (
                <span className="property-hint" style={{ color: 'var(--warning)' }}>
                  The saved trigger {existing?.trigger.source_id} v{existing?.trigger.source_version} is not served by
                  this gateway. Choose another source or remove the defaults.
                </span>
              ) : null}
            </div>

            {selected
              ? fields.map((field) => (
                  <ConfigField
                    key={field.key}
                    field={field}
                    values={values}
                    current={currentConfig}
                    onChange={(key, value) => setValues((prev) => ({ ...prev, [key]: value }))}
                  />
                ))
              : null}
            {selected && unsupported.length ? (
              <div className="property-hint" style={{ color: 'var(--error, #e74c3c)', marginTop: 8 }}>
                This source cannot be bound in the editor: its settings schema uses JSON Schema keywords the editor
                cannot check ({unsupported.join('; ')}).
              </div>
            ) : null}
            {selected && !unsupported.length && fields.length === 0 ? (
              <div className="property-hint" style={{ marginTop: 8 }}>
                This source has no settings.
              </div>
            ) : null}

            <div className="run-form-field" style={{ marginTop: 12 }}>
              <label className="run-form-label">Context</label>
              <select
                className="run-form-select"
                value={mode}
                onChange={(e) => setMode(e.target.value as AutomationContextMode)}
              >
                {AUTOMATION_CONTEXT_MODES.map((m) => (
                  <option key={m} value={m}>
                    {CONTEXT_LABELS[m]}
                  </option>
                ))}
              </select>
            </div>

            <div className="run-form-field" style={{ marginTop: 12 }}>
              <label className="run-form-label">Title (optional)</label>
              <input className="run-form-input" type="text" value={title} onChange={(e) => setTitle(e.target.value)} />
            </div>

            <div className="run-form-field" style={{ marginTop: 12 }}>
              <label className="run-form-label">Default input_data (JSON object)</label>
              <textarea
                className="run-form-input property-textarea code"
                rows={5}
                value={inputDataText}
                onChange={(e) => setInputDataText(e.target.value)}
              />
              <span className="property-hint">
                {pins.length ? (
                  <>
                    On Flow Start inputs: {pins.map((p, i) => <span key={p}>{i ? ', ' : ''}<code>{p}</code></span>)}.{' '}
                  </>
                ) : null}
                A string <code>prompt</code> is prefixed with the trigger line on every run.
              </span>
            </div>
          </>
        ) : null}

        {issues.length ? (
          <ul className="property-hint" style={{ color: 'var(--error, #e74c3c)', marginTop: 12 }}>
            {issues.map((issue, i) => (
              <li key={i}>
                {issue.field ? <code>{issue.field}</code> : null} {issue.message}
              </li>
            ))}
          </ul>
        ) : null}

        <div className="modal-actions">
          <button className="modal-button cancel" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          {existing ? (
            <button className="modal-button cancel" onClick={handleRemove} disabled={saving}>
              Remove defaults
            </button>
          ) : null}
          <button className="modal-button" onClick={() => void load(true)} disabled={saving || loading}>
            Refresh sources
          </button>
          <button className="modal-button" onClick={handleSave} disabled={saving || !selected || unsupported.length > 0}>
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
