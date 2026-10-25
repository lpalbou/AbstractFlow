/**
 * The Automation dialog of one flow (Flow Library > Automation…, the editor
 * header's nature badge): what starts it, its context and its inputs.
 *
 * "What starts it?" is the human picker shared with the New flow dialog
 * (components/automation/TriggerPicker.tsx; operator 2026-10-25): a schedule
 * in the person's time zone (schedule@2), one of their mailboxes, one of
 * their feeds or webhooks, or by hand. The chosen source's other settings
 * come from its own `config_schema` (utils/triggerBindings.ts) under "More
 * settings"; a setting the form cannot render is edited as JSON on its own,
 * it never blocks the source.
 *
 * Saving a trigger on a flow that cannot receive the event yet adds the
 * Trigger event node itself (utils/triggerEvent.ts) and hands the new graph
 * to the caller: the person is never asked to do it.
 */
import { useEffect, useMemo, useState } from 'react';
import type { AutomationContextMode, AutomationDefaults, AutomationTriggerDefaults, VisualFlow } from '../types/flow';
import type { GatewayContracts } from '../utils/gatewayClient';
import { type AvailableTriggerSource, type TriggerSourceItem } from '../utils/triggerSources';
import {
  AUTOMATION_DEFAULTS_SCHEMA_VERSION,
  DURATION_UNITS,
  assertValidAutomationDefaults,
  configFormFields,
  configFromFormValues,
  formValuesFromConfig,
  AutomationDefaultsError,
  type AutomationDefaultsIssue,
  type ConfigFormField,
  type ConfigFormValues,
} from '../utils/triggerBindings';
import { TriggerEventError, isTriggerableFlow, withTriggerEvent } from '../utils/triggerEvent';
import {
  AutomationChoiceError,
  budgetText,
  contextFromForm,
  formatTokens,
  connectionSources,
  mailSource,
  manualSource,
  scheduleSource,
  triggerFromChoice,
} from '../utils/automationChoice';
import { choiceFromPicker, emptyPicker, pickerFromTrigger, type PickerData, type PickerState } from '../utils/automationPicker';
import { enumWords, triggerSettingsCopy } from '../utils/triggerCopy';
import { TriggerPicker, pickerSupport } from './automation/TriggerPicker';
import { useAutomationFacts } from './automation/useAutomationFacts';

export interface AutomationGraph {
  nodes: VisualFlow['nodes'];
  edges: VisualFlow['edges'];
}

export interface AutomationDefaultsModalProps {
  flow: VisualFlow;
  gatewayContracts: GatewayContracts | null;
  onClose: () => void;
  /**
   * Store (or with null, remove) the defaults. `graph` is set when the flow
   * needed the Trigger event node: the caller stores it with the defaults.
   */
  onSave: (next: AutomationDefaults | null, extra?: { graph?: AutomationGraph }) => Promise<void> | void;
}

const CONTEXT_CHOICES: Array<{ mode: AutomationContextMode; title: string; sub: string }> = [
  { mode: 'independent', title: 'Independent', sub: 'Every run starts fresh.' },
  { mode: 'growing', title: 'Growing', sub: 'Every run continues the same conversation.' },
];

/** Independent / Growing, and the growing budget ("Remembers up to N tokens of earlier runs"). */
export function ContextChoice({
  mode,
  onMode,
  budget,
  onBudget,
  historyDefault,
  historyProblem,
}: {
  mode: AutomationContextMode;
  onMode: (mode: AutomationContextMode) => void;
  budget: string;
  onBudget: (text: string) => void;
  historyDefault: number | null;
  historyProblem: string;
}) {
  return (
    <div className="automation-picker">
      <div className="automation-choices" role="radiogroup" aria-label="Context">
        {CONTEXT_CHOICES.map((c) => (
          <button
            key={c.mode}
            type="button"
            role="radio"
            aria-checked={mode === c.mode}
            className={`automation-choice${mode === c.mode ? ' is-selected' : ''}`}
            onClick={() => onMode(c.mode)}
          >
            <span className="automation-choice-dot" aria-hidden="true" />
            <span className="automation-choice-text">
              <span className="automation-choice-title">{c.title}</span>
              <span className="automation-choice-sub">{c.sub}</span>
            </span>
          </button>
        ))}
      </div>
      {mode === 'growing' ? (
        <div className="automation-detail">
          <label className="automation-inline-field automation-budget">
            <span>Remembers up to</span>
            <input
              className="run-form-input automation-tokens"
              type="text"
              inputMode="numeric"
              value={budget}
              placeholder={historyDefault ? formatTokens(historyDefault) : 'the gateway’s default'}
              onChange={(e) => onBudget(e.target.value)}
              aria-label="Tokens of earlier runs it remembers"
            />
            <span>tokens of earlier runs</span>
          </label>
          <p className="automation-help">
            Each run reads the most recent part of the earlier runs, up to this budget, so it can build on them; a larger
            budget costs more tokens and time on every run.
          </p>
          <p className="automation-muted">
            {historyDefault
              ? `The gateway’s default is ${formatTokens(historyDefault)} tokens; keeping it means this automation follows the default if it changes.`
              : historyProblem
                ? `The gateway’s default could not be read (${historyProblem}); leave the field empty to use it.`
                : 'Reading the gateway’s default…'}
          </p>
        </div>
      ) : (
        <p className="automation-help automation-help--choice">Nothing is carried from one run to the next: each run sees only its own trigger and inputs.</p>
      )}
    </div>
  );
}

function startPinNames(flow: VisualFlow): string[] {
  const start = flow.nodes.find((n) => n.type === 'on_flow_start' || n.data?.nodeType === 'on_flow_start');
  const outputs = (start?.data?.outputs || []) as Array<{ id: string; type?: string }>;
  return outputs.filter((pin) => pin.type !== 'execution').map((pin) => pin.id);
}

function ConfigField({
  field,
  values,
  onChange,
}: {
  field: ConfigFormField;
  values: ConfigFormValues;
  onChange: (key: string, value: string) => void;
}) {
  const value = values[field.key] ?? '';
  const id = `automation-setting-${field.key.replace(/\W+/g, '-')}`;
  if (field.kind === 'group') {
    return (
      <details className="automation-group" open={(field.children || []).some((c) => (values[c.key] ?? '') !== '')}>
        <summary>{field.label}</summary>
        <div className="automation-group-body">
          {(field.children || []).map((child) => (
            <ConfigField key={child.key} field={child} values={values} onChange={onChange} />
          ))}
        </div>
      </details>
    );
  }
  let control: JSX.Element;
  switch (field.kind) {
    case 'duration':
      control = (
        <div className="automation-inline-row">
          <input
            id={id}
            className="run-form-input automation-amount"
            type="number"
            min={1}
            step={1}
            value={value}
            onChange={(e) => onChange(field.key, e.target.value)}
            aria-label={`${field.label} amount`}
          />
          <select
            className="run-form-select"
            value={values[`${field.key}#unit`] || 'm'}
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
        <select id={id} className="run-form-select" value={value} onChange={(e) => onChange(field.key, e.target.value)}>
          <option value="">Default</option>
          {(field.options || []).map((opt) => (
            <option key={JSON.stringify(opt)} value={JSON.stringify(opt)}>
              {enumWords(opt)}
            </option>
          ))}
        </select>
      );
      break;
    case 'boolean':
      control = (
        <select id={id} className="run-form-select" value={value} onChange={(e) => onChange(field.key, e.target.value)}>
          <option value="">Default</option>
          <option value="true">Yes</option>
          <option value="false">No</option>
        </select>
      );
      break;
    case 'integer':
    case 'number':
      control = (
        <input
          id={id}
          className="run-form-input"
          type="number"
          step={field.kind === 'integer' ? 1 : 'any'}
          value={value}
          onChange={(e) => onChange(field.key, e.target.value)}
        />
      );
      break;
    case 'list':
      control = (
        <textarea
          id={id}
          className="run-form-input property-textarea"
          rows={2}
          value={value}
          placeholder="One per line"
          onChange={(e) => onChange(field.key, e.target.value)}
        />
      );
      break;
    case 'json':
      control = (
        <textarea
          id={id}
          className="run-form-input property-textarea code"
          rows={3}
          value={value}
          onChange={(e) => onChange(field.key, e.target.value)}
          aria-describedby={`${id}-json`}
        />
      );
      break;
    default:
      control = (
        <input
          id={id}
          className="run-form-input"
          type="text"
          value={value}
          placeholder={field.kind === 'datetime' ? '2026-11-02T08:00:00Z' : ''}
          onChange={(e) => onChange(field.key, e.target.value)}
        />
      );
  }
  return (
    <div className="run-form-field automation-field">
      <label className="run-form-label" htmlFor={id}>
        {field.label}
        {field.required ? <span className="automation-required"> (required)</span> : null}
      </label>
      {control}
      {field.description ? <span className="property-hint">{field.description}</span> : null}
      {field.kind === 'json' ? (
        <span className="property-hint" id={`${id}-json`}>
          Written as JSON.
        </span>
      ) : null}
    </div>
  );
}

/** The source a picker state binds (null: nothing chosen, or not served). */
function pickedSource(
  picker: PickerState,
  sources: readonly TriggerSourceItem[],
  connections: Array<{ connection_id: string; source_id: string; source_version: number }> | null
): AvailableTriggerSource | null {
  if (picker.start === 'schedule') return picker.legacy ? null : scheduleSource(sources);
  if (picker.start === 'manual') return manualSource(sources);
  if (picker.start === 'arrives') {
    if (picker.arrival.startsWith('mail:')) return mailSource(sources);
    const conn = connections?.find((c) => `conn:${c.connection_id}` === picker.arrival);
    return conn ? connectionSources(sources).find((s) => s.id === conn.source_id && s.version === conn.source_version) || null : null;
  }
  return null;
}

/** A problem in words, named by the setting's label rather than its path. */
export function issueText(issue: AutomationDefaultsIssue, fields: ConfigFormField[]): string {
  const flat: ConfigFormField[] = [];
  const walk = (list: ConfigFormField[]) => list.forEach((f) => (f.kind === 'group' ? (flat.push(f), walk(f.children || [])) : flat.push(f)));
  walk(fields);
  const path = issue.field.replace(/^trigger\.config\./, '');
  const field = flat
    .filter((f) => path === f.key || path.startsWith(`${f.key}.`))
    .sort((a, b) => b.key.length - a.key.length)[0];
  if (field) return `${field.label}: ${issue.message}`;
  if (issue.field === 'trigger.connection_id') return `Connection: ${issue.message}`;
  if (issue.field.startsWith('input_data')) return `Inputs: ${issue.message}`;
  if (issue.field.startsWith('context')) return `Context: ${issue.message}`;
  if (issue.field.startsWith('trigger')) return `Trigger: ${issue.message}`;
  return issue.message;
}

function nextNodeId(nodes: VisualFlow['nodes']): string {
  const max = nodes.reduce((m, n) => {
    const hit = /^node-(\d+)$/.exec(n.id);
    return hit ? Math.max(m, Number(hit[1])) : m;
  }, 0);
  return `node-${max + 1}`;
}

/**
 * What Save stores, from the dialog's state (pure, tested): the validated
 * defaults and, when the flow cannot receive the event yet, the graph with
 * the Trigger event node added. Or the problems, in words.
 */
export function automationDraft(input: {
  flow: VisualFlow;
  existing: AutomationDefaults | null;
  picker: PickerState;
  keepsSaved: boolean;
  data: PickerData;
  formSource: AvailableTriggerSource | null;
  formOptions: { labels: Record<string, { label?: string; description?: string }>; omit: string[] };
  values: ConfigFormValues;
  context: AutomationDefaults['context'];
  title: string;
  inputData: unknown;
}): { next: AutomationDefaults; graph?: AutomationGraph } | { problems: string[] } {
  const { flow, existing, picker, data, formSource, formOptions, values } = input;
  const sources = data.sources;
  const found: string[] = [];
  const copy = triggerSettingsCopy(formSource?.id || '');
  const fields = formSource && !copy.noForm ? configFormFields(formSource.config_schema, formOptions) : [];
  let trigger: AutomationTriggerDefaults | null = null;
  if (picker.legacy) trigger = picker.legacy.trigger;
  else if (input.keepsSaved && existing) trigger = existing.trigger;
  else {
    const picked = choiceFromPicker(picker, data);
    if ('problem' in picked) found.push(picked.problem);
    else if (picked.choice.kind !== 'chat') {
      try {
        trigger = triggerFromChoice(picked.choice, sources);
      } catch (error) {
        if (!(error instanceof AutomationChoiceError)) throw error;
        found.push(error.message);
      }
    }
  }
  if (trigger && fields.length && formSource) {
    const built = configFromFormValues(formSource.config_schema, values, {}, { ...formOptions, validate: false });
    found.push(...built.issues.map((i) => issueText(i, fields)));
    // The picker owns its settings (mailbox, schedule); the form adds the rest.
    trigger = { ...trigger, config: { ...built.config, ...trigger.config } };
  }
  let graph: AutomationGraph | undefined;
  if (trigger && !isTriggerableFlow(flow)) {
    try {
      const next = withTriggerEvent(flow.nodes as never, flow.edges as never, { breakNodeId: nextNodeId(flow.nodes), edgeId: `edge-trigger-event-${nextNodeId(flow.nodes)}` });
      graph = { nodes: next.nodes as never, edges: next.edges as never };
    } catch (error) {
      if (!(error instanceof TriggerEventError)) throw error;
      found.push(error.message);
    }
  }
  if (!trigger && !found.length) found.push('Choose what starts it.');
  if (found.length || !trigger) return { problems: found };
  try {
    const next = assertValidAutomationDefaults(
      {
        schema_version: AUTOMATION_DEFAULTS_SCHEMA_VERSION,
        ...(input.title.trim() ? { title: input.title.trim() } : {}),
        trigger,
        context: input.context,
        input_data: input.inputData,
      },
      sources
    );
    return graph ? { next, graph } : { next };
  } catch (error) {
    if (error instanceof AutomationDefaultsError) return { problems: error.issues.map((i) => issueText(i, fields)) };
    throw error;
  }
}

export function AutomationDefaultsModal({ flow, gatewayContracts, onClose, onSave }: AutomationDefaultsModalProps) {
  const existing = flow.automation_defaults || null;
  const facts = useAutomationFacts(gatewayContracts);
  const support = pickerSupport(facts);
  const sources = support.data.sources;
  const sourcesReady = facts.sources.state === 'ok' && facts.sources.value.status === 'ok';
  const [picker, setPicker] = useState<PickerState>(emptyPicker(null));
  const [seeded, setSeeded] = useState(false);
  const [values, setValues] = useState<ConfigFormValues>({});
  const [mode, setMode] = useState<AutomationContextMode>(existing?.context?.mode || 'independent');
  const [title, setTitle] = useState(existing?.title || '');
  const historyDefault = facts.historyDefault.state === 'ok' ? facts.historyDefault.value : null;
  const [budget, setBudget] = useState('');
  const [budgetSeeded, setBudgetSeeded] = useState(false);
  // The budget field opens on the saved budget, else the gateway's one default.
  useEffect(() => {
    if (budgetSeeded || facts.historyDefault.state === 'loading') return;
    setBudgetSeeded(true);
    setBudget(budgetText(existing?.context, historyDefault));
  }, [budgetSeeded, facts.historyDefault.state, existing, historyDefault]);
  const [inputDataText, setInputDataText] = useState(JSON.stringify(existing?.input_data || {}, null, 2));
  const [issues, setIssues] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  // Seed the picker from the saved trigger once the sources are known.
  useEffect(() => {
    if (seeded || !sourcesReady) return;
    setSeeded(true);
    if (existing) setPicker(pickerFromTrigger(existing.trigger, support.data));
  }, [seeded, sourcesReady, existing, support.data]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !saving) onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose, saving]);

  const source = pickedSource(picker, sources, support.data.connections as never);
  // A saved trigger the picker cannot show (an older or third-party source) is kept until replaced.
  const keepsSaved = Boolean(existing && seeded && picker.start === null);
  const savedSource = existing ? sources.find((s): s is AvailableTriggerSource => s.available && s.id === existing.trigger.source_id && s.version === existing.trigger.source_version) || null : null;
  const formSource = source || (picker.legacy || keepsSaved ? savedSource : null);
  const copy = triggerSettingsCopy(formSource?.id || '');
  const formOptions = useMemo(() => ({ labels: copy.labels, omit: copy.omit }), [copy]);
  const fields = useMemo(
    () => (formSource && !copy.noForm ? configFormFields(formSource.config_schema, formOptions) : []),
    [formSource, copy, formOptions]
  );
  const savedConfig = existing && formSource && existing.trigger.source_id === formSource.id && existing.trigger.source_version === formSource.version ? existing.trigger.config : null;
  const formKey = formSource ? `${formSource.id}@${formSource.version}` : '';
  useEffect(() => {
    if (!formKey) return;
    setValues(savedConfig && formSource ? formValuesFromConfig(formSource.config_schema, savedConfig, formOptions) : {});
    // Re-seed only when the bound source changes.
  }, [formKey]);

  const handleSave = async () => {
    if (!sourcesReady) return;
    let inputData: unknown;
    const inputProblems: string[] = [];
    try {
      inputData = JSON.parse(inputDataText.trim() || '{}');
    } catch (error) {
      inputProblems.push(`Inputs: not valid JSON (${error instanceof Error ? error.message : String(error)})`);
    }
    const ctx = contextFromForm(mode, budget, historyDefault);
    if ('problem' in ctx) inputProblems.unshift(ctx.problem);
    const draft = automationDraft({
      flow,
      existing,
      picker,
      keepsSaved,
      data: support.data,
      formSource,
      formOptions,
      values,
      context: 'context' in ctx ? ctx.context : { mode },
      title,
      inputData,
    });
    if ('problems' in draft || inputProblems.length) {
      setIssues([...('problems' in draft ? draft.problems : []), ...inputProblems]);
      return;
    }
    const { next, graph } = draft;
    setIssues([]);
    setSaving(true);
    try {
      await onSave(next, graph ? { graph } : undefined);
      onClose();
    } catch (error) {
      setIssues([error instanceof Error ? error.message : String(error)]);
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
      setIssues([error instanceof Error ? error.message : String(error)]);
    } finally {
      setSaving(false);
    }
  };

  const pins = startPinNames(flow);
  const savedLabel = existing ? sources.find((s) => s.id === existing.trigger.source_id)?.label || 'another trigger' : '';

  return (
    <div className="modal-overlay" onClick={onClose} role="presentation">
      <div className="modal automation-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Automation defaults">
        <h3>Automation defaults</h3>
        <p className="property-hint">
          What an automation created from <strong>{flow.name}</strong> starts with: its trigger, context and inputs.
          Saved in the flow and published with it; creating the automation happens in AbstractObserver or the
          Assistant. Schedules are fixed UTC intervals.
        </p>

        {support.sourcesProblem ? (
          <p className={facts.sources.state === 'loading' ? 'automation-help' : 'automation-problem'}>
            {support.sourcesProblem}{' '}
            {facts.sources.state !== 'loading' ? (
              <button type="button" className="automation-link-button" onClick={facts.reloadSources}>
                Try again
              </button>
            ) : null}
          </p>
        ) : null}

        {sourcesReady ? (
          <>
            <section className="automation-section" aria-labelledby="automation-start-title">
              <h4 id="automation-start-title" className="automation-section-title">
                What starts it?
              </h4>
              {keepsSaved ? (
                <p className="automation-help">
                  Now: {savedLabel} <span className="automation-muted">· choose below to replace it</span>
                </p>
              ) : null}
              <TriggerPicker
                value={picker}
                onChange={setPicker}
                data={support.data}
                includeChat={false}
                timeZoneOrigin={facts.timeZone.origin}
                gatewayUrl={facts.gatewayUrl}
                arrivalsNote={support.arrivalsNote}
                onRefreshArrivals={facts.reloadArrivals}
                unavailable={support.unavailable}
                idPrefix="automation-trigger"
              />
              {fields.length ? (
                <details className="automation-more">
                  <summary>{copy.title}</summary>
                  <div className="automation-more-body">
                    {fields.map((field) => (
                      <ConfigField
                        key={field.key}
                        field={field}
                        values={values}
                        onChange={(key, value) => setValues((prev) => ({ ...prev, [key]: value }))}
                      />
                    ))}
                  </div>
                </details>
              ) : null}
            </section>

            <section className="automation-section" aria-labelledby="automation-context-title">
              <h4 id="automation-context-title" className="automation-section-title">
                Context
              </h4>
              <ContextChoice
                mode={mode}
                onMode={setMode}
                budget={budget}
                onBudget={setBudget}
                historyDefault={historyDefault}
                historyProblem={facts.historyDefault.state === 'error' ? facts.historyDefault.message : ''}
              />
            </section>

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
          <ul className="automation-issues" role="alert">
            {issues.map((issue, i) => (
              <li key={i}>{issue}</li>
            ))}
          </ul>
        ) : null}

        <div className="modal-actions">
          {existing ? (
            <button className="modal-button cancel automation-remove" onClick={handleRemove} disabled={saving}>
              Remove automation
            </button>
          ) : null}
          <button className="modal-button cancel" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button className="modal-button primary" onClick={handleSave} disabled={saving || !sourcesReady}>
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
