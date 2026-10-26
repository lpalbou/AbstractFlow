/**
 * Properties of the Mail and Publish nodes (operator wave 2026-10-25).
 *
 * Mail: the mailbox picker (the person's mailboxes by address; empty = the
 * flow's trigger mailbox, else the main one), a plain refusal when a node
 * would send from a read-only mailbox (known at design time), the folder
 * picker of Move to folder (`GET /api/gateway/me/email/accounts/{id}/folders`)
 * and Delete's "for good" option. Publish: the channel with suggestions and
 * the rules the gateway enforces, and the "Also notify me" toggle.
 */
import { NOTIFY_ME_CHANNEL_CHOICES, NOTIFY_ME_CHANNEL_HELP, notifyChoiceOn, notifyMeChannels, notifyMeReaches, toggleNotifyChoice } from '../../utils/afterTheRun';
import { useEffect, useMemo, useState } from 'react';
import { AfChipButton, AfSwitch } from '@abstractframework/ui-kit';
import type { Edge } from 'reactflow';
import type { FlowNodeData, JsonValue } from '../../types/flow';
import { useFlowStore } from '../../hooks/useFlow';
import { fetchMailboxes } from '../../utils/automationGateway';
import type { Mailbox } from '../../utils/automationChoice';
import {
  MAIL_QUERY_FIELDS,
  mailQueryFromForm,
  PUBLISH_CHANNEL_SUGGESTIONS,
  defaultMailboxFor,
  fetchMailboxFolders,
  folderLabel,
  type MailFolder,
  mailSendRefusal,
  publishChannelProblem,
} from '../../utils/mailNodes';

type Patch = (pinDefaults: Record<string, JsonValue>) => void;

function wired(edges: Edge[], nodeId: string, pin: string): boolean {
  return edges.some((e) => e.target === nodeId && e.targetHandle === pin);
}

export function MailNodeSection({ nodeId, data, onPinDefaults }: { nodeId: string; data: FlowNodeData; onPinDefaults: Patch }) {
  const edges = useFlowStore((s) => s.edges);
  const trigger = useFlowStore((s) => s.flowAutomationDefaults?.trigger) || null;
  const [mailboxes, setMailboxes] = useState<Mailbox[] | null>(null);
  const [mailboxError, setMailboxError] = useState('');
  const [folders, setFolders] = useState<MailFolder[] | null>(null);
  const [folderNote, setFolderNote] = useState('');
  const defaults = (data.pinDefaults || {}) as Record<string, JsonValue>;
  const type = String(data.nodeType);
  const hasMailboxPin = data.inputs.some((p) => p.id === 'mailbox');
  const chosen = typeof defaults.mailbox === 'string' ? defaults.mailbox : '';

  useEffect(() => {
    let alive = true;
    fetchMailboxes()
      .then((r) => alive && (r.status === 'ok' ? setMailboxes(r.mailboxes) : setMailboxError(r.reason)))
      .catch((e: unknown) => alive && setMailboxError(e instanceof Error ? e.message : String(e)));
    return () => {
      alive = false;
    };
  }, []);

  const fallback = useMemo(() => defaultMailboxFor(trigger, mailboxes || []), [trigger, mailboxes]);
  const effective = (mailboxes || []).find((m) => m.account_id === chosen || m.address === chosen) || fallback.mailbox;

  useEffect(() => {
    if (type !== 'mail_move' || !effective) return undefined;
    let alive = true;
    fetchMailboxFolders(effective.account_id)
      .then((r) => {
        if (!alive) return;
        if (r.status === 'ok') {
          setFolders(r.folders);
          setFolderNote('');
        } else {
          setFolders(null);
          setFolderNote(r.reason);
        }
      })
      .catch((e: unknown) => {
        if (!alive) return;
        setFolders(null);
        setFolderNote(`Type the folder name: the folders could not be read (${e instanceof Error ? e.message : String(e)}).`);
      });
    return () => {
      alive = false;
    };
  }, [type, effective]);

  const refusal = mailSendRefusal(type, effective || null, { mailboxChosen: Boolean(chosen), triggerIsMail: fallback.fromTrigger });

  return (
    <div className="property-section mail-node-section">
      {hasMailboxPin && !wired(edges, nodeId, 'mailbox') ? (
        <div className="run-form-field automation-field">
          <label className="property-label" htmlFor={`mailbox-${nodeId}`}>
            Mailbox
          </label>
          <select
            id={`mailbox-${nodeId}`}
            className="run-form-select"
            value={chosen}
            onChange={(e) => onPinDefaults({ ...defaults, mailbox: e.target.value })}
          >
            <option value="">{fallback.label}</option>
            {(mailboxes || [])
              .filter((m) => m.configured)
              .map((m) => (
                <option key={m.account_id} value={m.account_id}>
                  {m.address || m.account_id}
                  {m.can_send ? '' : ' (read-only)'}
                </option>
              ))}
          </select>
          {mailboxError ? <span className="property-hint">Your mailboxes could not be read: {mailboxError}</span> : null}
        </div>
      ) : null}
      {refusal ? (
        <p className="automation-problem" role="alert">
          {refusal}
        </p>
      ) : null}
      {type === 'mail_search' && !wired(edges, nodeId, 'query') ? (
        <SearchQueryForm
          query={(defaults.query && typeof defaults.query === 'object' && !Array.isArray(defaults.query) ? defaults.query : {}) as Record<string, JsonValue>}
          onQuery={(query) => onPinDefaults({ ...defaults, query })}
        />
      ) : null}
      {type === 'mail_move' && !wired(edges, nodeId, 'folder') ? (
        <div className="run-form-field automation-field">
          <label className="property-label" htmlFor={`folder-${nodeId}`}>
            Move to
          </label>
          {folders ? (
            <select
              id={`folder-${nodeId}`}
              className="run-form-select"
              value={typeof defaults.folder === 'string' ? defaults.folder : ''}
              onChange={(e) => onPinDefaults({ ...defaults, folder: e.target.value })}
            >
              <option value="">Choose a folder…</option>
              {folders.map((f) => (
                <option key={f.name} value={f.name}>
                  {folderLabel(f)}
                </option>
              ))}
            </select>
          ) : (
            <input
              id={`folder-${nodeId}`}
              className="run-form-input"
              value={typeof defaults.folder === 'string' ? defaults.folder : ''}
              placeholder="Folder name, e.g. Archive"
              onChange={(e) => onPinDefaults({ ...defaults, folder: e.target.value })}
            />
          )}
          {folderNote ? <span className="property-hint">{folderNote}</span> : null}
        </div>
      ) : null}
      {type === 'mail_delete' ? (
        <details className="automation-more">
          <summary>More options</summary>
          <div className="automation-more-body">
            <AfSwitch
              variant="row"
              label="Delete for good"
              description="Off: the email goes to the Trash."
              action="mail-delete-permanent"
              checked={defaults.permanent === true}
              onChange={(on: boolean) => onPinDefaults({ ...defaults, permanent: on })}
            />
          </div>
        </details>
      ) : null}
    </div>
  );
}

/** Search mail's query as fields (from, to, subject, contains, since, until, unread / flagged only, labels). */
function SearchQueryForm({ query, onQuery }: { query: Record<string, JsonValue>; onQuery: (q: Record<string, JsonValue>) => void }) {
  const values: Record<string, string | boolean> = {};
  for (const f of MAIL_QUERY_FIELDS) {
    const v = query[f.key];
    values[f.key] = f.kind === 'bool' ? v === true : f.kind === 'list' ? (Array.isArray(v) ? v.join('\n') : '') : typeof v === 'string' ? v : '';
  }
  const set = (key: string, value: string | boolean) => onQuery(mailQueryFromForm({ ...values, [key]: value }) as Record<string, JsonValue>);
  return (
    <div className="mail-query-form">
      <span className="property-label">Look for</span>
      {MAIL_QUERY_FIELDS.map((f) =>
        f.kind === 'bool' ? (
          <AfSwitch key={f.key} variant="row" label={f.label} action={`mail-query-${f.key}`} checked={values[f.key] === true} onChange={(on: boolean) => set(f.key, on)} />
        ) : (
          <div key={f.key} className="run-form-field automation-field">
            <label className="run-form-label">{f.label}</label>
            {f.kind === 'list' ? (
              <textarea className="run-form-input property-textarea" rows={2} value={String(values[f.key])} onChange={(e) => set(f.key, e.target.value)} />
            ) : (
              <input className="run-form-input" type={f.kind === 'date' ? 'date' : 'text'} value={String(values[f.key])} onChange={(e) => set(f.key, e.target.value)} />
            )}
            {f.help ? <span className="property-hint">{f.help}</span> : null}
          </div>
        )
      )}
    </div>
  );
}

export function PublishNodeSection({
  nodeId,
  data,
  onPinDefaults,
  onEffectConfig,
}: {
  nodeId: string;
  data: FlowNodeData;
  onPinDefaults: Patch;
  /** Notify me's Who / Where, saved in the node's effectConfig (`channels`; absent = every channel). */
  onEffectConfig?: (effectConfig: NonNullable<FlowNodeData['effectConfig']>) => void;
}) {
  const edges = useFlowStore((s) => s.edges);
  const nodes = useFlowStore((s) => s.nodes);
  const defaults = (data.pinDefaults || {}) as Record<string, JsonValue>;
  // "Notify me" is Publish to channel with its channel and alert fixed (no channel pin).
  const isNotify = !data.inputs.some((p) => p.id === 'channel');
  const channel = typeof defaults.channel === 'string' ? defaults.channel : '';
  const used = nodes
    .filter((n) => n.data.nodeType === 'publish_event' && n.id !== nodeId)
    .map((n) => (n.data.pinDefaults as Record<string, JsonValue> | undefined)?.channel)
    .filter((c): c is string => typeof c === 'string' && Boolean(c));
  const suggestions = Array.from(new Set([...used, ...PUBLISH_CHANNEL_SUGGESTIONS]));
  const problem = !isNotify && !wired(edges, nodeId, 'channel') ? publishChannelProblem(channel) : null;
  const alert = isNotify || defaults.alert === true;
  const channels = notifyMeChannels(data);
  const pickWhere = (value: string) => {
    const next = toggleNotifyChoice(channels, value);
    const { channels: _old, ...rest } = (data.effectConfig || {}) as NonNullable<FlowNodeData['effectConfig']>;
    onEffectConfig?.(next ? { ...rest, channels: next } : rest);
  };
  return (
    <div className="property-section mail-node-section">
      <p className="property-hint">
        {isNotify
          ? `${notifyMeReaches(channels)}.`
          : 'Applications that subscribe to this channel receive it; with Alert on, you are notified on the tray, the Assistant, the watch and the phone.'}
      </p>
      {isNotify ? (
        // Who and where (ADR-0041): the recipient is you (another account comes later); where is
        // a set of chips saved as effectConfig.channels, honoured by the tray, push and email.
        <div className="run-form-field automation-field">
          <label className="property-label" htmlFor={`notify-to-${nodeId}`}>
            Who
          </label>
          <select id={`notify-to-${nodeId}`} className="run-form-input" value="me" disabled aria-describedby={`notify-help-${nodeId}`}>
            <option value="me">Me</option>
          </select>
          <span className="property-label" id={`notify-channels-${nodeId}`}>
            Where
          </span>
          <div className="notify-where" role="group" aria-labelledby={`notify-channels-${nodeId}`} data-field="notify-where">
            {NOTIFY_ME_CHANNEL_CHOICES.map((c) => (
              <AfChipButton
                key={c.value}
                size="sm"
                tone={notifyChoiceOn(c, channels) ? 'accent' : 'neutral'}
                pressed={notifyChoiceOn(c, channels)}
                disabled={!onEffectConfig}
                onClick={() => pickWhere(c.value)}
              >
                {c.label}
              </AfChipButton>
            ))}
          </div>
          <span className="property-hint" id={`notify-help-${nodeId}`}>
            {NOTIFY_ME_CHANNEL_HELP}
          </span>
        </div>
      ) : null}
      {!isNotify && !wired(edges, nodeId, 'channel') ? (
        <div className="run-form-field automation-field">
          <label className="property-label" htmlFor={`channel-${nodeId}`}>
            Channel
          </label>
          <input
            id={`channel-${nodeId}`}
            className="run-form-input"
            list={`channels-${nodeId}`}
            value={channel}
            placeholder="results"
            onChange={(e) => onPinDefaults({ ...defaults, channel: e.target.value })}
          />
          <datalist id={`channels-${nodeId}`}>
            {suggestions.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
          {problem ? <span className="automation-problem">{problem}</span> : null}
        </div>
      ) : null}
      {!isNotify && !wired(edges, nodeId, 'alert') ? (
        <AfSwitch
          variant="row"
          label="Also notify me"
          description="On the tray, the Assistant, the watch and the phone."
          action="publish-alert"
          checked={alert}
          onChange={(on: boolean) => onPinDefaults({ ...defaults, alert: on })}
        />
      ) : null}
    </div>
  );
}
