// Operator rule 2026-11-07 in the Run form: changing the text provider or model puts reasoning and
// MTP back on the default; a reasoning level or MTP value the selected model cannot use is never sent.
import { describe, expect, it } from 'vitest';
import { sendableRunPins, withRouteOptionsReset } from './runModelOptions';

const DEPTH2 = { mode: 'native_mtp', num_draft_tokens: 2, require_acceleration: true };
const NO_MTP = { capabilities: { reasoning_levels: ['low', 'high'] }, execution: { speculation: { supported: false, reason: 'native_mtp_backend_unavailable', supported_depths: [] } } };
const MTP = { execution: { speculation: { supported: true, supported_depths: [2, 3] } } };

describe('run form model options', () => {
  it('a provider or model change clears the reasoning and MTP pins', () => {
    expect(withRouteOptionsReset({ provider: 'a', model: 'b', thinking: 'high', speculation: JSON.stringify(DEPTH2), prompt: 'hi' }, ['thinking', 'speculation']))
      .toEqual({ provider: 'a', model: 'b', thinking: '', speculation: '', prompt: 'hi' });
    expect(withRouteOptionsReset({ model: 'b' }, ['speculation'])).toEqual({ model: 'b', speculation: '' });
  });
  it('drops a saved MTP depth for a model without MTP, and a level the model does not offer', () => {
    expect(sendableRunPins({ speculation: DEPTH2, thinking: 'high', prompt: 'x' }, { speculationCard: NO_MTP, reasoningCard: NO_MTP }))
      .toEqual({ speculation: undefined, thinking: 'high', prompt: 'x' });
    // An explicit Off is always kept (kit 0.9.19 rule): dropping it would let a gateway default with MTP on win.
    expect(sendableRunPins({ speculation: false, thinking: 'xhigh' }, { speculationCard: NO_MTP, reasoningCard: NO_MTP }))
      .toEqual({ speculation: false, thinking: undefined });
  });
  it('keeps what the model supports; no card = no MTP', () => {
    expect(sendableRunPins({ speculation: DEPTH2 }, { speculationCard: MTP, reasoningCard: MTP })).toEqual({ speculation: DEPTH2 });
    expect(sendableRunPins({ speculation: DEPTH2 }, { speculationCard: undefined, reasoningCard: undefined })).toEqual({ speculation: undefined });
  });
  it('keeps a level when the model serves no reasoning facts (unknown is not unsupported; kit usableReasoning)', () => {
    // No card yet, or a card without reasoning levels: the dialog offers no level, the level still rides.
    expect(sendableRunPins({ thinking: 'high' }, { speculationCard: undefined, reasoningCard: undefined })).toEqual({ thinking: 'high' });
    expect(sendableRunPins({ thinking: 'high' }, { speculationCard: MTP, reasoningCard: MTP })).toEqual({ thinking: 'high' });
    // Only what the served card rules out is dropped: an unlisted level, or thinking_support false.
    expect(sendableRunPins({ thinking: 'medium' }, { speculationCard: undefined, reasoningCard: NO_MTP })).toEqual({ thinking: undefined });
    expect(sendableRunPins({ thinking: 'high' }, { speculationCard: undefined, reasoningCard: { capabilities: { thinking_support: false } } }))
      .toEqual({ thinking: undefined });
    // Gateway default stays the default.
    expect(sendableRunPins({ thinking: '' }, { speculationCard: undefined, reasoningCard: NO_MTP })).toEqual({ thinking: '' });
  });
  it('leaves inputs without these pins untouched', () => {
    expect(sendableRunPins({ prompt: 'x' }, { speculationCard: undefined, reasoningCard: undefined })).toEqual({ prompt: 'x' });
  });
});
