/**
 * The Automation dialog of one flow (Flow Library > Automation…, the editor
 * header's nature badge): what starts it, its context and its inputs.
 *
 * "What starts it?" is the human picker shared with the New flow dialog
 * (components/automation/TriggerPicker.tsx; operator 2026-10-25): one of
 * their mailboxes, one of their feeds or webhooks, or by hand. Never a
 * schedule (operator ruling 2026-10-25: set in Observer or the Assistant); a
 * flow saved earlier with a schedule keeps it, said in words, until the
 * person picks another start. The chosen source's other settings
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
import { triggerPinKind, withTriggerPins } from '../utils/triggerPins';
import {
  AutomationChoiceError,
  budgetText,
  contextFromForm,
  formatTokens,
  connectionSources,
  mailSource,
  manualSource,
  SCHEDULE_ELSEWHERE,
  isScheduleTrigger,
  triggerFromChoice,
  triggerSentence,
} from '../utils/automationChoice';
import { choiceFromPicker, emptyPicker, pickerFromTrigger, type PickerData, type PickerState } from '../utils/automationPicker';
import { enumWords, triggerSettingsCopy } from '../utils/triggerCopy';
import { inputDataFromForm, inputFields, inputFormFromData, modelOptions, providerOptions, type InputField, type InputValues, type ModelCatalog } from '../utils/automationInputs';
import { useModelCatalog } from './automation/useModelCatalog';
import { TriggerPicker, pickerSupport } from './automation/TriggerPicker';
import { LoadingLine, ReadFailed } from './ReadState';
import { useAutomationFacts } from './automation/useAutomationFacts';
import { OPEN_OBSERVER_LABEL, observerAutomationsUrl, turnedOnSentence, updatedSentence } from '../utils/automationTurnOn';
import { linkedStatusWords, type LinkedAutomation } from '../utils/automationLink';
import { IconBolt } from './ToolbarIcons';

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
  /**
   * "Turn it on": after the defaults are stored, make the flow available and
   * create the automation (utils/automationTurnOn.ts). Throws the problem in words.
   */
  onTurnOn?: (next: AutomationDefaults) => Promise<{ title: string; updated?: boolean }>;
  /** The automation this flow already has: the dialog offers Update / Turn it off instead of a second one. */
  link?: AutomationLinkApi;
}

export interface AutomationLinkApi {
  find: () => Promise<LinkedAutomation | null>;
  setOn: (on: boolean) => Promise<void>;
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

/** The automation's inputs, one field per On Flow Start input (utils/automationInputs.ts). */
export function InputsForm({
  fields,
  values,
  onValues,
  raw,
  onRaw,
  catalog = null,
}: {
  fields: InputField[];
  values: InputValues;
  onValues: (next: InputValues) => void;
  raw: string;
  onRaw: (text: string) => void;
  catalog?: ModelCatalog | null;
}) {
  const providerField = fields.find((f) => f.kind === 'provider');
  const chosenProvider = providerField ? values[providerField.id] ?? '' : '';
  const set = (id: string, value: string) => onValues({ ...values, [id]: value });
  return (
    <div className="automation-inputs">
      {fields.length ? null : <p className="automation-help">This flow takes no inputs besides what arrives.</p>}
      {fields.map((field) => {
        const id = `automation-input-${field.id.replace(/\W+/g, '-')}`;
        const value = values[field.id] ?? '';
        let control: JSX.Element;
        switch (field.kind) {
          case 'prompt':
            control = (
              <textarea
                id={id}
                className="run-form-input property-textarea"
                rows={4}
                value={value}
                placeholder="e.g. Summarise the new messages and tell me which need an answer today."
                onChange={(e) => set(field.id, e.target.value)}
              />
            );
            break;
          case 'provider':
          case 'model': {
            const options = field.kind === 'provider' ? providerOptions(catalog, value) : modelOptions(catalog, chosenProvider, value);
            control = (
              <select id={id} className="run-form-select" value={value} onChange={(e) => set(field.id, e.target.value)}>
                {options.map((o) => (
                  <option key={o.value || '(default)'} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            );
            break;
          }
          case 'number':
            control = <input id={id} className="run-form-input" type="number" step="any" value={value} onChange={(e) => set(field.id, e.target.value)} />;
            break;
          case 'boolean':
            control = (
              <select id={id} className="run-form-select" value={value} onChange={(e) => set(field.id, e.target.value)}>
                <option value="">Not set</option>
                <option value="true">Yes</option>
                <option value="false">No</option>
              </select>
            );
            break;
          case 'json':
            control = (
              <textarea id={id} className="run-form-input property-textarea code" rows={3} value={value} onChange={(e) => set(field.id, e.target.value)} />
            );
            break;
          default:
            control = <input id={id} className="run-form-input" type="text" value={value} onChange={(e) => set(field.id, e.target.value)} />;
        }
        return (
          <div key={field.id} className="run-form-field automation-field">
            <label className="run-form-label" htmlFor={id}>
              {field.label}
            </label>
            {control}
            {field.help ? <span className="property-hint">{field.help}</span> : null}
            {field.kind === 'json' ? <span className="property-hint">Written as JSON.</span> : null}
          </div>
        );
      })}
      {fields.length || raw.trim() ? (
      <details className="automation-more" open={Boolean(raw.trim())}>
        <summary>Advanced: raw JSON</summary>
        <div className="automation-more-body">
          <textarea
            className="run-form-input property-textarea code"
            rows={4}
            value={raw}
            placeholder="{}"
            aria-label="Other inputs as raw JSON"
            onChange={(e) => onRaw(e.target.value)}
          />
          <span className="property-hint">Other inputs the fields above do not cover, as one JSON object. Most automations need nothing here.</span>
        </div>
      </details>
      ) : null}
    </div>
  );
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
  // What an empty field means, never an example that reads as if filled (re-review #12).
  const schemaDefault = (field.schema as { default?: unknown }).default;
  const emptyMeans = schemaDefault !== undefined && schemaDefault !== null && typeof schemaDefault !== 'object' ? `${String(schemaDefault)} (default)` : '';
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
          placeholder={emptyMeans}
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
          placeholder={field.kind === 'datetime' ? 'Empty: from now' : emptyMeans}
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
  if (input.keepsSaved && existing) trigger = existing.trigger;
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
    // The picker owns its settings (the mailbox); the form adds the rest.
    trigger = { ...trigger, config: { ...built.config, ...trigger.config } };
  }
  // What arrives goes on On Flow Start as the trigger's typed pins (and On
  // Flow End gets response / success / note, ADR-0041): added here, never asked for.
  let graph: AutomationGraph | undefined;
  if (trigger) {
    const starts = flow.nodes.filter((n) => n.type === 'on_flow_start' || n.data?.nodeType === 'on_flow_start');
    if (starts.length !== 1) {
      found.push(starts.length ? 'The flow has several On Flow Start nodes: keep one, then save again.' : 'The flow has no On Flow Start node: add one, then save again.');
    } else {
      const nodes = withTriggerPins(flow.nodes as never, triggerPinKind(trigger));
      if (nodes !== (flow.nodes as never)) graph = { nodes: nodes as never, edges: flow.edges };
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

export function AutomationDefaultsModal({ flow, gatewayContracts, onClose, onSave, onTurnOn, link }: AutomationDefaultsModalProps) {
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
  const inputFieldList = useMemo(() => inputFields(flow), [flow]);
  const seededInputs = useMemo(() => inputFormFromData(inputFieldList, existing?.input_data || {}), [inputFieldList, existing]);
  const [inputValues, setInputValues] = useState<InputValues>(seededInputs.values);
  const [rawInputs, setRawInputs] = useState(seededInputs.raw);
  const providerInput = inputFieldList.find((f) => f.kind === 'provider');
  const modelCatalog = useModelCatalog(gatewayContracts, providerInput ? inputValues[providerInput.id] ?? '' : '');
  const [issues, setIssues] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [turningOn, setTurningOn] = useState(false);
  const [turnedOn, setTurnedOn] = useState<{ title: string; updated?: boolean } | null>(null);
  const [linked, setLinked] = useState<LinkedAutomation | null>(null);
  const [linkNote, setLinkNote] = useState('');
  useEffect(() => {
    let alive = true;
    if (!link) return undefined;
    link
      .find()
      .then((l) => alive && setLinked(l))
      .catch(() => alive && setLinked(null)); // Turn it on itself never duplicates (it re-checks)
    return () => {
      alive = false;
    };
  }, [link]);
  const switchOn = async (on: boolean) => {
    if (!link) return;
    setSaving(true);
    setIssues([]);
    try {
      await link.setOn(on);
      setLinkNote(on ? 'It is on again.' : 'It is off (paused). Turn it back on here or in Observer.');
      setLinked(await link.find());
    } catch (error) {
      setIssues([error instanceof Error ? error.message : String(error)]);
    } finally {
      setSaving(false);
    }
  };

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
  // A saved trigger the picker does not offer (a schedule from an older save,
  // a third-party source) is kept until another start is picked.
  const keepsSaved = Boolean(existing && seeded && picker.start === null);
  const savedSource = existing ? sources.find((s): s is AvailableTriggerSource => s.available && s.id === existing.trigger.source_id && s.version === existing.trigger.source_version) || null : null;
  const formSource = source || (keepsSaved ? savedSource : null);
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

  const handleSave = async (action: 'save' | 'turn-on' = 'save') => {
    if (!sourcesReady) return;
    const inputs = inputDataFromForm(inputFieldList, inputValues, rawInputs);
    const inputProblems: string[] = 'problems' in inputs ? [...inputs.problems] : [];
    const inputData = 'input_data' in inputs ? inputs.input_data : {};
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
      if (action === 'turn-on' && onTurnOn) {
        setTurningOn(true);
        const on = await onTurnOn(next);
        setTurnedOn(on);
        return;
      }
      onClose();
    } catch (error) {
      setIssues([error instanceof Error ? error.message : String(error)]);
    } finally {
      setSaving(false);
      setTurningOn(false);
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

  const savedSchedule = isScheduleTrigger(existing?.trigger);
  const savedLabel = !existing
    ? ''
    : savedSchedule
      ? triggerSentence(existing.trigger, { mailboxes: support.data.mailboxes, connections: support.data.connections })
      : sources.find((s) => s.id === existing.trigger.source_id)?.label || 'another trigger';

  return (
    <div className="modal-overlay" onClick={onClose} role="presentation">
      <div
        className="modal automation-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="automation-dialog-title"
      >
        <div className="new-flow-header">
          <span className="new-flow-header-icon automation-header-icon" aria-hidden="true">
            <IconBolt />
          </span>
          <div>
            <h3 id="automation-dialog-title">Automation</h3>
            <p className="new-flow-subtitle">{flow.name}</p>
          </div>
        </div>
        <p className="automation-intro">
          When the trigger fires, this flow runs with these inputs. Turn it on here; pause or stop it in Observer or the Assistant.
        </p>

        {turnedOn ? (
          <TurnedOnPanel title={turnedOn.title} updated={turnedOn.updated} gatewayUrl={facts.gatewayUrl} onClose={onClose} />
        ) : null}
        {!turnedOn && support.sourcesLoading ? (
          <LoadingLine text="Loading what this gateway can run" />
        ) : !turnedOn && support.sourcesProblem ? (
          <ReadFailed onRetry={facts.reloadSources} retryLabel="Try again">
            {support.sourcesProblem}
          </ReadFailed>
        ) : null}

        {sourcesReady && !turnedOn ? (
          <>
            <section className="automation-section" aria-labelledby="automation-start-title">
              <h4 id="automation-start-title" className="automation-section-title">
                What starts it?
              </h4>
              {keepsSaved ? (
                <p className="automation-help automation-kept-trigger">
                  Now: {savedLabel}{' '}
                  <span className="automation-muted">
                    {savedSchedule ? `· a schedule from an earlier save, kept as it is. ${SCHEDULE_ELSEWHERE} Choose below to replace it.` : '· choose below to replace it'}
                  </span>
                </p>
              ) : null}
              <TriggerPicker
                value={picker}
                onChange={setPicker}
                data={support.data}
                includeChat={false}
                gatewayUrl={facts.gatewayUrl}
                arrivalsRead={support.arrivalsRead}
                onRefreshArrivals={facts.reloadArrivals}
                onRetrySources={facts.reloadSources}
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

            <section className="automation-section" aria-labelledby="automation-inputs-title">
              <h4 id="automation-inputs-title" className="automation-section-title">
                Inputs
              </h4>
              <InputsForm
                fields={inputFieldList}
                values={inputValues}
                onValues={setInputValues}
                raw={rawInputs}
                onRaw={setRawInputs}
                catalog={modelCatalog}
              />
            </section>

            <section className="automation-section" aria-labelledby="automation-name-title">
              <div className="run-form-field automation-field">
                <label id="automation-name-title" className="run-form-label" htmlFor="automation-name">
                  Name <span className="new-flow-optional">optional</span>
                </label>
                <input
                  id="automation-name"
                  className="run-form-input"
                  type="text"
                  value={title}
                  placeholder={flow.name}
                  onChange={(e) => setTitle(e.target.value)}
                />
                <span className="property-hint">How automations made from this flow are named in Observer and the Assistant.</span>
              </div>
            </section>
          </>
        ) : null}

        {turnedOn ? null : (
        <div className="automation-footer">
          {issues.length ? (
            <ul className="automation-issues" role="alert">
              {issues.map((issue, i) => (
                <li key={i}>{issue}</li>
              ))}
            </ul>
          ) : null}
          {linked || linkNote ? (
            <p className="automation-linked" role="status">
              {linked ? (
                <>
                  <strong>{linkedStatusWords(linked)}</strong> · see it in Observer
                  {facts.gatewayUrl ? (
                    <>
                      {' '}
                      <a href={observerAutomationsUrl(facts.gatewayUrl) || undefined} target="_blank" rel="noreferrer">
                        {OPEN_OBSERVER_LABEL}
                      </a>
                    </>
                  ) : null}
                </>
              ) : null}
              {linkNote ? <span className="automation-muted"> {linkNote}</span> : null}
            </p>
          ) : null}
          <div className="modal-actions">
            {existing && !linked ? (
              <button className="modal-button cancel automation-remove" onClick={handleRemove} disabled={saving}>
                Remove the trigger
              </button>
            ) : null}
            {linked && (linked.status === 'active' || linked.status === 'paused') ? (
              <button className="modal-button cancel automation-remove" onClick={() => void switchOn(linked.status !== 'active')} disabled={saving}>
                {linked.status === 'active' ? 'Turn it off' : 'Turn it back on'}
              </button>
            ) : null}
            <button className="modal-button cancel" onClick={onClose} disabled={saving}>
              Cancel
            </button>
            <button className={`modal-button${onTurnOn ? ' cancel' : ' primary'}`} onClick={() => void handleSave('save')} disabled={saving || !sourcesReady}>
              Save
            </button>
            {onTurnOn ? (
              <button className="modal-button primary" onClick={() => void handleSave('turn-on')} disabled={saving || !sourcesReady}>
                {turningOn ? (linked ? 'Updating…' : 'Turning it on…') : linked ? 'Update the automation' : 'Turn it on'}
              </button>
            ) : null}
          </div>
        </div>
        )}
      </div>
    </div>
  );
}

/** After "Turn it on": one sentence and where to see it. */
export function TurnedOnPanel({ title, updated, gatewayUrl, onClose }: { title: string; updated?: boolean; gatewayUrl: string; onClose: () => void }) {
  const observer = observerAutomationsUrl(gatewayUrl);
  return (
    <div className="automation-on" role="status">
      <p className="automation-on-sentence">{updated ? updatedSentence(title) : turnedOnSentence(title)}</p>
      <div className="modal-actions">
        {observer ? (
          <a className="modal-button cancel automation-on-link" href={observer} target="_blank" rel="noreferrer">
            {OPEN_OBSERVER_LABEL}
          </a>
        ) : null}
        <button className="modal-button primary" onClick={onClose}>
          Done
        </button>
      </div>
    </div>
  );
}
