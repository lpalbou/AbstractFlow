/**
 * What a flow is, said where it is seen (operator 2026-10-25: "it should be
 * clear what I am creating: a flow for chat or a flow for automation"): the
 * editor header and the library row show "Automation · When mail arrives in
 * me@example.org" or "Chat". The mailbox address and connection names are
 * read from the gateway only when the trigger needs them.
 */
import { useEffect, useState } from 'react';
import type { AutomationDefaults, AutomationTriggerDefaults } from '../../types/flow';
import { flowNature, type AutomationWords } from '../../utils/automationChoice';
import { fetchMailboxes } from '../../utils/automationGateway';
import { fetchTriggerConnections } from '../../utils/triggerConnections';

/** Mailboxes / connections the trigger's sentence names (loaded once per trigger). */
export function useTriggerWords(trigger: AutomationTriggerDefaults | null | undefined): AutomationWords {
  return useAutomationWords(triggerNeedsWords(trigger));
}

/** Which gateway lists a trigger's sentence names. */
export function triggerNeedsWords(trigger: AutomationTriggerDefaults | null | undefined): { mail: boolean; conn: boolean } {
  return {
    mail: Boolean(trigger && trigger.source_id.startsWith('email')),
    conn: Boolean(trigger && (trigger.connection_id || trigger.config?.connection_id)),
  };
}

/** The mailboxes / connections, loaded only when `need` says so. */
export function useAutomationWords(need: { mail: boolean; conn: boolean }): AutomationWords {
  const [words, setWords] = useState<AutomationWords>({});
  const needsMail = need.mail;
  const needsConn = need.conn;
  useEffect(() => {
    let alive = true;
    if (needsMail) {
      fetchMailboxes()
        .then((r) => alive && r.status === 'ok' && setWords((w) => ({ ...w, mailboxes: r.mailboxes })))
        .catch(() => undefined); // the sentence falls back to the mailbox id
    }
    if (needsConn) {
      fetchTriggerConnections()
        .then((r) => alive && r.status === 'ok' && setWords((w) => ({ ...w, connections: r.connections })))
        .catch(() => undefined); // the sentence falls back to "a feed" / "a webhook"
    }
    return () => {
      alive = false;
    };
  }, [needsMail, needsConn]);
  return words;
}

export function FlowNatureBadge({
  automation,
  executable,
  onClick,
  onTurnOn,
  words,
}: {
  automation: AutomationDefaults | null | undefined;
  executable: boolean;
  /** Open the Automation dialog. */
  onClick?: () => void;
  /** Turn the saved automation on (in the badge's menu when there is one). */
  onTurnOn?: () => void;
  words?: AutomationWords;
}) {
  const [menuAt, setMenuAt] = useState<{ top: number; left: number } | null>(null);
  const open = menuAt !== null;
  const setOpen = (next: boolean | ((v: boolean) => boolean)) => {
    if (!(typeof next === 'function' ? next(open) : next)) setMenuAt(null);
  };
  const nature = flowNature({ automation_defaults: automation }, executable, words);
  if (nature.kind === 'none' && !onClick) return null;
  const plain = nature.kind === 'none' ? 'Automation…' : nature.text;
  // "Automation" never truncates; the trigger sentence after it does (UX review #19).
  const text =
    nature.kind === 'automation' ? (
      <>
        <span className="flow-nature-kind">Automation</span>
        <span className="flow-nature-rest">{`\u00a0${plain.slice('Automation'.length).trimStart()}`}</span>
      </>
    ) : (
      plain
    );
  const title =
    nature.kind === 'automation'
      ? nature.text
      : 'Make it an automation: a schedule, new mail, a feed or a webhook starts it';
  const className = `flow-nature-badge flow-nature-badge--${nature.kind}`;
  if (!onClick) return <span className={className} title={plain}>{text}</span>;
  // An automation gets a small menu (Automation… / Turn it on); otherwise the badge opens the dialog.
  if (nature.kind !== 'automation' || !onTurnOn) {
    return (
      <button type="button" className={className} onClick={onClick} title={title}>
        {text}
      </button>
    );
  }
  return (
    <span className="flow-nature-menu-wrap">
      <button
        type="button"
        className={className}
        onClick={(e) => {
          if (open) return setMenuAt(null);
          // Fixed position: the header strip clips overflow (UX review #19).
          const r = e.currentTarget.getBoundingClientRect();
          setMenuAt({ top: r.bottom + 6, left: r.left });
        }}
        title={title}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        {text}
      </button>
      {menuAt ? (
        <span className="flow-nature-menu" role="menu" style={{ top: menuAt.top, left: menuAt.left }} onMouseLeave={() => setOpen(false)}>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onClick();
            }}
          >
            Automation…
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onTurnOn();
            }}
          >
            Turn it on
          </button>
        </span>
      ) : null}
    </span>
  );
}
