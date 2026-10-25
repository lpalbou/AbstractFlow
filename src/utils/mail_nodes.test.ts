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
import { defaultMailboxFor, fetchMailboxFolders, mailSendRefusal, publishChannelProblem } from './mailNodes';
import { parseMailboxes } from './automationGateway';
import { ME_EMAIL_RESPONSE } from './triggerSources.fixtures';

const template = (label: string) => getAllNodeTemplates().find((t) => t.label === label)!;

describe('the Mail and publish catalog', () => {
  it('has the fixed-verb mail nodes, Publish to channel and Notify me, in their own palette section', () => {
    expect(NODE_CATEGORIES.mail.nodes.map((t) => `${t.type}:${t.label}`)).toEqual([
      'mail_search:Search mail',
      'mail_get:Get mail',
      'mail_mark_read:Mark as read',
      'mail_mark_unread:Mark as unread',
      'mail_flag:Flag',
      'mail_unflag:Unflag',
      'mail_add_label:Add label',
      'mail_remove_label:Remove label',
      'mail_move:Move to folder',
      'mail_delete:Delete',
      'mail_send:Send mail',
      'mail_reply:Reply',
      'mail_forward:Forward',
      'mail_get_attachment:Get attachment',
      'break_object:Email fields',
      'publish_event:Publish to channel',
      'notify_me:Notify me',
    ]);
    expect(PALETTE_SECTION_DEFS.find((d) => d.key === 'mail')?.label).toBe('Mail and publish');
  });

  it('types its pins: Search gives an Email list, the verbs take an Email, Get attachment gives a file', () => {
    const pins = (label: string, side: 'inputs' | 'outputs') => template(label)[side].map((p) => `${p.id}:${p.type}`);
    expect(pins('Search mail', 'inputs')).toEqual([
      'exec-in:execution', 'mailbox:string', 'folder:string', 'from:string', 'to:string', 'subject:string', 'contains:string',
      'since:string', 'until:string', 'unread_only:boolean', 'flagged_only:boolean', 'labels:array', 'limit:number',
    ]);
    expect(pins('Search mail', 'outputs')).toEqual(['exec-out:execution', 'emails:emails', 'count:number']);
    for (const verb of ['Mark as read', 'Mark as unread', 'Flag', 'Unflag', 'Add label', 'Remove label', 'Move to folder', 'Delete', 'Reply', 'Forward', 'Get attachment']) {
      expect(pins(verb, 'inputs')).toContain('email:email');
    }
    expect(pins('Get attachment', 'outputs')).toContain('file:artifact');
    expect(pins('Send mail', 'inputs')).toEqual(['exec-in:execution', 'mailbox:string', 'to:array', 'cc:array', 'bcc:array', 'subject:string', 'text:string', 'html:string', 'attachments:artifacts']);
    expect(pins('Reply', 'inputs')).toContain('reply_all:boolean');
    expect(pins('Publish to channel', 'inputs')).toEqual(['exec-in:execution', 'channel:string', 'type:string', 'title:string', 'body:string', 'data:object', 'subject:string', 'alert:boolean']);
    expect(template('Publish to channel').description).toBe(
      'Applications that subscribe to this channel receive it; with Alert on, you are notified on the tray, the Assistant and the watch.'
    );
    expect(createNodeData(template('Publish to channel')).pinDefaults).toEqual({ channel: 'results', alert: false });
    expect(pins('Notify me', 'inputs')).toEqual(['exec-in:execution', 'title:string', 'body:string', 'data:object']);
    // Every mail pin explains itself on hover.
    for (const t of NODE_CATEGORIES.mail.nodes) for (const p of t.inputs) if (p.type !== 'execution' && t.type !== 'publish_event') expect(p.description, `${t.label}.${p.id}`).toBeTruthy();
  });

  it('Email fields: a Break Object preset on an email, one typed output per field; Break Object stays the canonical template', () => {
    const t = template('Email fields');
    expect(t.type).toBe('break_object');
    expect(t.inputs.map((p) => `${p.id}:${p.type}`)).toEqual(['object:email']);
    expect(t.outputs.map((p) => p.id)).toEqual([...EMAIL_FIELDS]);
    expect(t.outputs.find((p) => p.id === 'seen')?.type).toBe('boolean');
    expect(t.outputs.find((p) => p.id === 'attachments')?.description).toMatch(/index, name, size, type/);
    expect(createNodeData(t).breakConfig?.selectedPaths).toEqual([...EMAIL_FIELDS]);
    expect(getNodeTemplate('break_object')?.label).toBe('Break Object');
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
    expect(areTypesCompatible('email', 'emails')).toBe(false);
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
    expect(validateConnection(typed, edges, { source: 'l', sourceHandle: 'item', target: 'm', targetHandle: 'email' })).toBe(true);
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

  it('folders come from the gateway; without the route the node says to type the name', async () => {
    await expect(fetchMailboxFolders('default', async () => ({ folders: [{ name: 'INBOX' }, 'Archive'] }))).resolves.toEqual({ status: 'ok', folders: ['INBOX', 'Archive'] });
    await expect(
      fetchMailboxFolders('default', async () => {
        throw new GatewayHttpError('nf', 404, null);
      })
    ).resolves.toEqual({ status: 'unavailable', reason: 'This gateway does not list folders yet: type the folder name on the node.' });
  });
});
