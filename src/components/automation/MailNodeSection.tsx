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
import { useEffect, useMemo, useState } from 'react';
import { AfSwitch } from '@abstractframework/ui-kit';
import type { Edge } from 'reactflow';
import type { FlowNodeData, JsonValue } from '../../types/flow';
import { useFlowStore } from '../../hooks/useFlow';
import { fetchMailboxes } from '../../utils/automationGateway';
import type { Mailbox } from '../../utils/automationChoice';
import {
  PUBLISH_CHANNEL_SUGGESTIONS,
  defaultMailboxFor,
  fetchMailboxFolders,
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
  const [folders, setFolders] = useState<string[] | null>(null);
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
      .catch((e: unknown) => alive && setFolderNote(`The folders could not be read: ${e instanceof Error ? e.message : String(e)}`));
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
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
          ) : null}
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

export function PublishNodeSection({ nodeId, data, onPinDefaults }: { nodeId: string; data: FlowNodeData; onPinDefaults: Patch }) {
  const edges = useFlowStore((s) => s.edges);
  const nodes = useFlowStore((s) => s.nodes);
  const defaults = (data.pinDefaults || {}) as Record<string, JsonValue>;
  const isNotify = data.nodeType === 'notify_me';
  const channel = typeof defaults.channel === 'string' ? defaults.channel : '';
  const used = nodes
    .filter((n) => n.data.nodeType === 'publish_event' && n.id !== nodeId)
    .map((n) => (n.data.pinDefaults as Record<string, JsonValue> | undefined)?.channel)
    .filter((c): c is string => typeof c === 'string' && Boolean(c));
  const suggestions = Array.from(new Set([...used, ...PUBLISH_CHANNEL_SUGGESTIONS]));
  const problem = !isNotify && !wired(edges, nodeId, 'channel') ? publishChannelProblem(channel) : null;
  const alert = isNotify || defaults.alert === true;
  return (
    <div className="property-section mail-node-section">
      <p className="property-hint">
        {isNotify
          ? 'You are notified on the tray, the Assistant and the watch.'
          : 'Applications that subscribe to this channel receive it; with Alert on, you are notified on the tray, the Assistant and the watch.'}
      </p>
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
          description="On the tray, the Assistant and the watch."
          action="publish-alert"
          checked={alert}
          onChange={(on: boolean) => onPinDefaults({ ...defaults, alert: on })}
        />
      ) : null}
    </div>
  );
}
