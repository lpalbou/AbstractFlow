import { describe, expect, it } from 'vitest';
import type { FlowNodeData } from '../types/flow';
import { createNodeData, getNodeTemplate } from '../types/nodes';
import {
  decisionAnswerSchema,
  decisionLevels,
  decisionOptionNames,
  decisionOutputPins,
  decisionOutputPinsForData,
  normalizeDecisionQuestionType,
  withDecisionOutputs,
  mergeDecisionOptionRows,
} from './decisionPins';
import { getNodePinDisclosure } from './nodePinDisclosure';
import { inferSchemaForNodeOutput } from './outputSchemaInference';
import { fromVisualFlow } from './serialization';

const ids = (pins: { id: string }[]) => pins.map((p) => p.id);

function decideNode(pinDefaults: Record<string, unknown>): FlowNodeData {
  const data = structuredClone(createNodeData(getNodeTemplate('decide')!));
  data.pinDefaults = { ...(data.pinDefaults || {}), ...pinDefaults } as FlowNodeData['pinDefaults'];
  return withDecisionOutputs(data);
}

describe('decision pins', () => {
  it('normalizes the question type to choice | noul | score', () => {
    expect(normalizeDecisionQuestionType(undefined)).toBe('choice');
    expect(normalizeDecisionQuestionType(' Score ')).toBe('score');
    expect(normalizeDecisionQuestionType('noul')).toBe('noul');
    expect(normalizeDecisionQuestionType('yesno')).toBe('choice');
  });

  it('reads option names from a list or a {name: description} object, and levels from a list', () => {
    expect(decisionOptionNames(['returns', ' shipping ', '', 'returns'])).toEqual(['returns', 'shipping']);
    expect(decisionOptionNames({ returns: 'Refunds', shipping: 'Delivery' })).toEqual(['returns', 'shipping']);
    expect(decisionOptionNames([{ name: 'a' }, { name: 'b' }])).toEqual(['a', 'b']);
    expect(decisionOptionNames('returns')).toEqual([]);
    expect(decisionLevels(['Calm', 'Angry'])).toEqual(['Calm', 'Angry']);
    expect(decisionLevels({ Calm: 1 })).toEqual([]);
  });

  it('choice: choice (enum = the options), confidence, probabilities (one number per option), then the common pins', () => {
    const pins = decisionOutputPins('choice', ['returns', 'shipping']);
    expect(ids(pins)).toEqual(['exec-out', 'choice', 'confidence', 'probabilities', 'answer', 'model', 'success', 'answers', 'meta']);
    expect(pins.find((p) => p.id === 'choice')).toMatchObject({ type: 'string', schema: { type: 'string', enum: ['returns', 'shipping'] } });
    expect(pins.find((p) => p.id === 'probabilities')?.schema).toEqual({
      type: 'object',
      properties: { returns: { type: 'number' }, shipping: { type: 'number' } },
    });
    expect(pins.find((p) => p.id === 'answer')?.schema).toEqual(decisionAnswerSchema('choice', ['returns', 'shipping'], []));
    expect(decisionAnswerSchema('choice', ['returns', 'shipping'], [])).toEqual({
      type: 'object',
      properties: {
        type: { const: 'choice' },
        choice: { type: 'string', enum: ['returns', 'shipping'] },
        confidence: { type: 'number' },
        probabilities: { type: 'object', properties: { returns: { type: 'number' }, shipping: { type: 'number' } } },
      },
    });
    // No options yet: a plain string, never an empty enum.
    expect(decisionOutputPins('choice').find((p) => p.id === 'choice')?.schema).toEqual({ type: 'string' });
  });

  it('noul: noul (P(true)) and verdict (noul ≥ 0.5)', () => {
    const pins = decisionOutputPins('noul');
    expect(ids(pins)).toEqual(['exec-out', 'noul', 'verdict', 'answer', 'model', 'success', 'answers', 'meta']);
    expect(pins.find((p) => p.id === 'noul')?.type).toBe('number');
    expect(pins.find((p) => p.id === 'verdict')?.type).toBe('boolean');
    expect(decisionAnswerSchema('noul', [], [])).toEqual({
      type: 'object',
      properties: { type: { const: 'noul' }, noul: { type: 'number' } },
    });
  });

  it('score: score, level (enum = the levels), confidence, probabilities keyed by level index', () => {
    const pins = decisionOutputPins('score', [], ['Calm', 'Frustrated', 'Very angry']);
    expect(ids(pins)).toEqual(['exec-out', 'score', 'level', 'confidence', 'probabilities', 'answer', 'model', 'success', 'answers', 'meta']);
    expect(pins.find((p) => p.id === 'level')?.schema).toEqual({ type: 'string', enum: ['Calm', 'Frustrated', 'Very angry'] });
    expect(pins.find((p) => p.id === 'probabilities')?.schema).toEqual({
      type: 'object',
      properties: { '0': { type: 'number' }, '1': { type: 'number' }, '2': { type: 'number' } },
    });
    const answer = decisionAnswerSchema('score', [], ['Calm', 'Frustrated', 'Very angry']);
    expect(Object.keys((answer.properties as Record<string, unknown>))).toEqual(['type', 'score', 'confidence', 'legend', 'probabilities']);
  });

  it('the template is the choice form, question_type defaults to choice, and the outputs follow the pin defaults', () => {
    const template = getNodeTemplate('decide')!;
    expect(template.label).toBe('Decision');
    expect(template.category).toBe('core');
    expect(template.gatewayCapability).toBe('decision');
    expect(ids(template.inputs)).toEqual(['exec-in', 'state', 'question', 'question_type', 'options', 'levels', 'model', 'truncate', 'questions']);
    expect(ids(template.outputs)).toEqual(ids(decisionOutputPins('choice')));
    const data = createNodeData(template);
    expect(data.pinDefaults).toEqual({ question_type: 'choice' });
    expect(ids(decisionOutputPinsForData({ pinDefaults: { question_type: 'score', levels: ['low', 'high'] } }))).toContain('level');
  });

  it('withDecisionOutputs rewrites a decide node from its defaults and leaves other nodes alone', () => {
    const scored = decideNode({ question_type: 'score', levels: ['low', 'high'] });
    expect(ids(scored.outputs)).toContain('level');
    expect(ids(scored.outputs)).not.toContain('choice');
    const llm = structuredClone(createNodeData(getNodeTemplate('llm_call')!));
    expect(withDecisionOutputs(llm)).toBe(llm);
  });

  it('a saved decide node loads with its outputs re-derived from question_type / options', () => {
    const saved = decideNode({ question_type: 'choice', options: ['returns', 'shipping'] });
    const stale = { ...saved, outputs: decisionOutputPins('noul') }; // an older save that kept the wrong pins
    const flow = fromVisualFlow({
      id: 'f',
      name: 'f',
      nodes: [{ id: 'd', type: 'decide', position: { x: 0, y: 0 }, data: stale }],
      edges: [],
    });
    const loaded = flow.nodes[0].data;
    expect(ids(loaded.outputs)).toEqual(ids(decisionOutputPins('choice', ['returns', 'shipping'])));
    expect(loaded.outputs.find((p) => p.id === 'choice')?.schema).toEqual({ type: 'string', enum: ['returns', 'shipping'] });
  });

  it('Break Object reads the answer schema straight off the pin (choice enum included)', () => {
    const data = decideNode({ question_type: 'choice', options: ['returns', 'shipping'] });
    const node = { id: 'd', type: 'custom', position: { x: 0, y: 0 }, data };
    const answer = inferSchemaForNodeOutput(node, 'answer', [node], []);
    expect((answer?.properties as Record<string, { enum?: string[] }>).choice.enum).toEqual(['returns', 'shipping']);
    expect(inferSchemaForNodeOutput(node, 'choice', [node], [])?.enum).toEqual(['returns', 'shipping']);
  });

  it('disclosure: state, question, question_type, model and the per-type list are primary; truncate and questions wait behind the disclosure', () => {
    const disclose = (data: FlowNodeData) =>
      getNodePinDisclosure({
        data,
        inputs: data.inputs,
        outputs: data.outputs,
        connectedInputPinIds: new Set(),
        connectedOutputPinIds: new Set(),
        expanded: false,
      });
    const choice = disclose(decideNode({ question_type: 'choice' }));
    expect(ids(choice.inputPins)).toEqual(['exec-in', 'state', 'question', 'question_type', 'options', 'model']);
    expect(ids(choice.outputPins)).toEqual(['exec-out', 'choice', 'confidence', 'probabilities', 'answer', 'model', 'success']);
    expect(ids(choice.hiddenInputPins)).toEqual(['levels', 'truncate', 'questions']);
    expect(ids(choice.hiddenOutputPins)).toEqual(['answers', 'meta']);

    const score = disclose(decideNode({ question_type: 'score', levels: ['low', 'high'] }));
    expect(ids(score.inputPins)).toEqual(['exec-in', 'state', 'question', 'question_type', 'levels', 'model']);
    expect(ids(score.outputPins)).toEqual(['exec-out', 'score', 'level', 'confidence', 'probabilities', 'answer', 'model', 'success']);

    const noul = disclose(decideNode({ question_type: 'noul' }));
    expect(ids(noul.inputPins)).toEqual(['exec-in', 'state', 'question', 'question_type', 'model']);
    expect(ids(noul.outputPins)).toEqual(['exec-out', 'noul', 'verdict', 'answer', 'model', 'success']);
  });
});

describe('mergeDecisionOptionRows', () => {
  it('keeps the descriptions of a {name: description} object while rows are edited', () => {
    const previous = { returns: 'Exchanges and refunds', shipping: 'Delivery', billing: 'Charges' };
    expect(mergeDecisionOptionRows(previous, ['returns', 'delivery', 'billing', ''])).toEqual({
      returns: 'Exchanges and refunds',
      delivery: 'Delivery',
      billing: 'Charges',
      '': null,
    });
  });

  it('keeps a plain list a list and drops the pin when no rows remain', () => {
    expect(mergeDecisionOptionRows(['a'], ['a', 'b'])).toEqual(['a', 'b']);
    expect(mergeDecisionOptionRows({ a: 'x' }, [])).toBeUndefined();
  });
});
