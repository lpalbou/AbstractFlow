// Operator wave 2026-10-25: deterministic email handling and application-
// agnostic pushes in Flow. Pins the catalog entries, the Email pin types and
// their wiring, ForEach's Email item, the Email fields accessor and the
// design-time mail rules.
import { describe, expect, it } from 'vitest';
import { NODE_CATEGORIES, createNodeData, getAllNodeTemplates, getNodeTemplate } from '../types/nodes';
import type { FlowNodeData } from '../types/flow';
import type { Node } from 'reactflow';
import { EMAIL_FIELDS } from './emailType';
import { areTypesCompatible, validateConnection } from './validation';
import { withLoopItemTypes } from './relays';
import { triggerStartPins } from './triggerPins';
import { PALETTE_SECTION_DEFS } from './paletteModel';
import { GatewayHttpError } from './gatewayClient';
import { defaultMailboxFor, fetchMailboxFolders, folderLabel, mailSendRefusal, publishChannelProblem } from './mailNodes';
import { parseMailboxes } from './automationGateway';
import { ME_EMAIL_RESPONSE } from './triggerSources.fixtures';

const template = (label: string) => getAllNodeTemplates().find((t) => t.label === label)!;

describe('the Mail and publish catalog (abstractruntime 0.12.0 contract)', () => {
  it('has the runtime\'s node types, fixed-verb presets, Publish to channel and Notify me, in their own palette section', () => {
    expect(NODE_CATEGORIES.mail.nodes.map((t) => `${t.type}:${t.label}${t.preset ? '*' : ''}`)).toEqual([
      'mail_search:Search mail',
      'mail_get:Get mail',
      'mail_mark:Mark mail',
      'mail_mark:Mark as read*',
      'mail_mark:Mark as unread*',
      'mail_mark:Flag*',
      'mail_mark:Unflag*',
      'mail_label:Label mail',
      'mail_label:Add label*',
      'mail_label:Remove label*',
      'mail_move:Move to folder',
      'mail_delete:Delete',
      'mail_send:Send mail',
      'mail_reply:Reply',
      'mail_forward:Forward',
      'mail_attachment:Get attachment',
      'break_object:Email fields*',
      'publish_event:Publish to channel',
      'publish_event:Notify me*',
    ]);
    expect(PALETTE_SECTION_DEFS.find((d) => d.key === 'mail')?.label).toBe('Mail and publish');
    // The canonical template of each type is the plain one, never a preset.
    expect(getNodeTemplate('mail_mark')?.label).toBe('Mark mail');
    expect(getNodeTemplate('publish_event')?.label).toBe('Publish to channel');
  });

  it('carries exactly the compiler\'s argument pins and its output pins', () => {
    // abstractruntime visualflow_compiler/visual/executor.py CAMERA_TOOL_INVOKE_ARG_PINS (read 2026-10-25)
    const ARG_PINS: Record<string, string[]> = {
      mail_search: ['mailbox', 'query', 'folder', 'limit'],
      mail_get: ['mailbox', 'ids'],
      mail_mark: ['mailbox', 'ids', 'seen', 'flagged'],
      mail_label: ['mailbox', 'ids', 'add', 'remove'],
      mail_move: ['mailbox', 'ids', 'folder'],
      mail_delete: ['mailbox', 'ids', 'permanent'],
      mail_send: ['mailbox', 'to', 'cc', 'bcc', 'subject', 'text', 'html', 'attachments'],
      mail_reply: ['mailbox', 'id', 'text', 'html', 'reply_all'],
      mail_forward: ['mailbox', 'id', 'to', 'note'],
      mail_attachment: ['mailbox', 'id', 'index'],
      publish_event: ['channel', 'type', 'title', 'body', 'subject', 'data', 'alert'],
    };
    for (const [type, pins] of Object.entries(ARG_PINS)) {
      const t = getNodeTemplate(type as never)!;
      expect(t.inputs.filter((p) => p.type !== 'execution').map((p) => p.id), type).toEqual(pins);
      expect(t.outputs.map((p) => p.id).slice(0, 3), type).toEqual(['exec-out', 'result', 'success']);
    }
    const out = (type: string) => getNodeTemplate(type as never)!.outputs.map((p) => `${p.id}:${p.type}`);
    expect(out('mail_search')).toContain('emails:emails');
    expect(out('mail_get')).toContain('emails:emails');
    expect(out('mail_send')).toContain('message_id:string');
    expect(out('mail_attachment')).toContain('artifact:artifact');
    const pin = (type: string, id: string) => getNodeTemplate(type as never)!.inputs.find((p) => p.id === id)!;
    expect(pin('mail_mark', 'ids').type).toBe('emails');
    expect(pin('mail_reply', 'id').type).toBe('email');
    expect(template('Publish to channel').description).toBe(
      'Applications that subscribe to this channel receive it; with Alert on, you are notified on the tray, the Assistant and the watch.'
    );
  });

  it('presets fix the verb\'s arguments as pin defaults (the runtime applies them without a pin)', () => {
    expect(createNodeData(template('Mark as read')).pinDefaults).toEqual({ seen: true });
    expect(createNodeData(template('Mark as unread')).pinDefaults).toEqual({ seen: false });
    expect(createNodeData(template('Flag')).pinDefaults).toEqual({ flagged: true });
    expect(createNodeData(template('Unflag')).pinDefaults).toEqual({ flagged: false });
    expect(template('Add label').inputs.map((p) => p.id)).toEqual(['exec-in', 'mailbox', 'ids', 'add']);
    expect(createNodeData(template('Notify me')).pinDefaults).toEqual({ channel: 'me', alert: true });
    expect(createNodeData(template('Publish to channel')).pinDefaults).toEqual({ channel: 'results', alert: false });
  });

  it('Email fields: a Break Object preset on an email, one typed output per field; Break Object stays canonical', () => {
    const t = template('Email fields');
    expect(t.type).toBe('break_object');
    expect(t.inputs.map((p) => `${p.id}:${p.type}`)).toEqual(['object:email']);
    expect(t.outputs.map((p) => p.id)).toEqual([...EMAIL_FIELDS]);
    expect(t.outputs.find((p) => p.id === 'seen')?.type).toBe('boolean');
    expect(t.outputs.find((p) => p.id === 'message_id')?.description).toMatch(/Message-ID/);
    expect(createNodeData(t).breakConfig?.selectedPaths).toEqual([...EMAIL_FIELDS]);
    expect(getNodeTemplate('break_object')?.label).toBe('Break Object');
  });

  it('Search mail\'s Properties write the runtime\'s query keys', async () => {
    const { mailQueryFromForm } = await import('./mailNodes');
    expect(mailQueryFromForm({ from: ' boss@example.org ', text: 'invoice', unseen: true, flagged: false, labels: 'a\nb', since: '2026-10-01' })).toEqual({
      from: 'boss@example.org',
      text: 'invoice',
      unseen: true,
      labels: ['a', 'b'],
      since: '2026-10-01',
    });
  });
});

describe('Email pins', () => {
  it('an email wires to object/any, an Email list to array/any, never to other types', () => {
    expect(areTypesCompatible('email', 'object')).toBe(true);
    expect(areTypesCompatible('object', 'email')).toBe(true);
    expect(areTypesCompatible('email', 'any')).toBe(true);
    expect(areTypesCompatible('emails', 'array')).toBe(true);
    expect(areTypesCompatible('array', 'emails')).toBe(true);
    expect(areTypesCompatible('email', 'string')).toBe(false);
    expect(areTypesCompatible('emails', 'email')).toBe(false);
    // One Email where the mail verbs take a list (ForEach item -> Mark as read).
    expect(areTypesCompatible('email', 'emails')).toBe(true);
  });

  it('the mail trigger\'s messages are an Email list; ForEach over it gives an Email that Email fields and Mark as read take as is', () => {
    expect(triggerStartPins('email')[0]).toMatchObject({ id: 'messages', type: 'emails' });
    const node = (id: string, t: ReturnType<typeof template> | ReturnType<typeof getNodeTemplate>) =>
      ({ id, type: 'custom', position: { x: 0, y: 0 }, data: createNodeData(t!) }) as Node<FlowNodeData>;
    const start = { id: 's', type: 'custom', position: { x: 0, y: 0 }, data: { nodeType: 'on_flow_start', label: '', inputs: [], outputs: [{ id: 'exec-out', label: '', type: 'execution' }, ...triggerStartPins('email')] } } as unknown as Node<FlowNodeData>;
    const loop = node('l', getNodeTemplate('loop'));
    const fields = node('f', template('Email fields'));
    const mark = node('m', template('Mark as read'));
    const edges = [{ id: 'e1', source: 's', sourceHandle: 'messages', target: 'l', targetHandle: 'items' }];
    expect(validateConnection([start, loop], [], { source: 's', sourceHandle: 'messages', target: 'l', targetHandle: 'items' })).toBe(true);
    const typed = withLoopItemTypes([start, loop, fields, mark], edges);
    const item = typed.find((n) => n.id === 'l')!.data.outputs.find((p) => p.id === 'item')!;
    expect(item.type).toBe('email');
    expect(validateConnection(typed, edges, { source: 'l', sourceHandle: 'item', target: 'f', targetHandle: 'object' })).toBe(true);
    expect(validateConnection(typed, edges, { source: 'l', sourceHandle: 'item', target: 'm', targetHandle: 'ids' })).toBe(true);
    // Unwired, the item is `any` again; a second pass changes nothing.
    const back = withLoopItemTypes(typed, []);
    expect(back.find((n) => n.id === 'l')!.data.outputs.find((p) => p.id === 'item')!.type).toBe('any');
    expect(withLoopItemTypes(back, [])).toBe(back);
  });
});

describe('design-time mail rules', () => {
  const MAILBOXES = parseMailboxes(ME_EMAIL_RESPONSE);
  it('the default mailbox is the trigger\'s, else the main one', () => {
    expect(defaultMailboxFor({ source_id: 'email.received', source_version: 1, config: { account: 'work' } }, MAILBOXES)).toMatchObject({ fromTrigger: true, label: 'The trigger’s mailbox (work@example.org)' });
    expect(defaultMailboxFor(null, MAILBOXES)).toMatchObject({ fromTrigger: false, label: 'Your main mailbox (test@abstractframework.ai)' });
  });

  it('sending from a read-only mailbox is refused in words when the mailbox is known', () => {
    const readOnly = MAILBOXES.find((m) => m.account_id === 'work')!;
    expect(readOnly.can_send).toBe(false);
    expect(mailSendRefusal('mail_send', readOnly, { mailboxChosen: true, triggerIsMail: false })).toBe(
      'work@example.org is read-only: it can be watched but cannot send mail. Choose a mailbox that can send.'
    );
    expect(mailSendRefusal('mail_reply', readOnly, { mailboxChosen: false, triggerIsMail: true })).toMatch(/replies and forwards go out from it/);
    expect(mailSendRefusal('mail_reply', readOnly, { mailboxChosen: false, triggerIsMail: false })).toBeNull();
    expect(mailSendRefusal('mail_mark_read', readOnly, { mailboxChosen: true, triggerIsMail: true })).toBeNull();
    expect(mailSendRefusal('mail_send', MAILBOXES.find((m) => m.primary)!, { mailboxChosen: false, triggerIsMail: false })).toBeNull();
  });

  it('channels follow the gateway\'s rule; attention is its own', () => {
    expect(publishChannelProblem('results')).toBeNull();
    expect(publishChannelProblem('attention')).toMatch(/turn on Also notify me/);
    expect(publishChannelProblem('My Channel')).toMatch(/lowercase letters/);
    expect(publishChannelProblem('')).toMatch(/Name the channel/);
  });

  it('folders come from the gateway (primary or by mailbox id), special ones with their role word; a failure means typing the name', async () => {
    const answer = { folders: [{ name: 'INBOX', special: 'inbox', messages: 12 }, { name: '[Gmail]/Trash', special: 'trash' }, { name: 'Receipts', special: null }] };
    const paths: string[] = [];
    const fetchJson = async (p: string) => (paths.push(p), answer);
    const primary = await fetchMailboxFolders('default', fetchJson);
    await fetchMailboxFolders('', fetchJson);
    await fetchMailboxFolders('work', fetchJson);
    expect(paths).toEqual(['api/gateway/me/email/folders', 'api/gateway/me/email/folders', 'api/gateway/me/email/accounts/work/folders']);
    expect(primary.status === 'ok' && primary.folders.map(folderLabel)).toEqual(['INBOX', '[Gmail]/Trash · Trash', 'Receipts']);
    await expect(
      fetchMailboxFolders('work', async () => {
        throw new GatewayHttpError('nf', 404, null);
      })
    ).resolves.toEqual({ status: 'unavailable', reason: 'Type the folder name: this gateway does not list folders.' });
    const broken = await fetchMailboxFolders('work', async () => {
      throw new GatewayHttpError('HTTP 502', 502, null);
    });
    expect(broken.status === 'unavailable' && broken.reason).toMatch(/^Type the folder name: the folders could not be read/);
  });
});
