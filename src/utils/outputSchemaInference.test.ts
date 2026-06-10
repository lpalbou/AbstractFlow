import { describe, expect, it } from 'vitest';
import type { FlowNodeData } from '../types/flow';
import { createNodeData, getNodeTemplate } from '../types/nodes';
import {
  getSchemaByPath,
  inferSchemaForNodeOutput,
  normalizeResponseSchemaValue,
} from './outputSchemaInference';

function nodeData(type: FlowNodeData['nodeType']): FlowNodeData {
  const template = getNodeTemplate(type);
  if (!template) throw new Error(`missing template: ${type}`);
  return structuredClone(createNodeData(template));
}

describe('output schema inference', () => {
  it('normalizes a properties-map response schema value', () => {
    expect(normalizeResponseSchemaValue({ completion: 0, quality: 0 })).toEqual({
      type: 'object',
      properties: {
        completion: { type: 'integer' },
        quality: { type: 'integer' },
      },
      required: ['completion', 'quality'],
    });
  });

  it('reads schema metadata from any output pin, including subflow outputs', () => {
    const evaluationsSchema = {
      type: 'object',
      properties: {
        score: { type: 'number' },
        verdict: { type: 'string', enum: ['pass', 'fail'] },
      },
    };
    const subflow = nodeData('subflow');
    subflow.outputs = [
      { id: 'exec-out', label: '', type: 'execution' },
      { id: 'evaluations', label: 'evaluations', type: 'object', schema: evaluationsSchema },
    ];

    const nodes = [{ id: 'judge_subflow', type: 'subflow', position: { x: 0, y: 0 }, data: subflow }];
    const schema = inferSchemaForNodeOutput(nodes[0], 'evaluations', nodes, []);

    expect(schema).toEqual(evaluationsSchema);
    expect(getSchemaByPath(schema, 'score')).toEqual({ type: 'number' });
  });

  it('infers LLM structured data schema from a connected schema-value source pin', () => {
    const start = nodeData('on_flow_start');
    start.outputs = [
      { id: 'exec-out', label: '', type: 'execution' },
      {
        id: 'criteria',
        label: 'criteria',
        type: 'object',
        schema: normalizeResponseSchemaValue({ completion: 0, quality: 0 }),
      },
    ];

    const llm = nodeData('llm_call');
    const nodes = [
      { id: 'start', type: 'on_flow_start', position: { x: 0, y: 0 }, data: start },
      { id: 'llm', type: 'llm_call', position: { x: 200, y: 0 }, data: llm },
    ];
    const edges = [
      {
        id: 'schema-edge',
        source: 'start',
        sourceHandle: 'criteria',
        target: 'llm',
        targetHandle: 'resp_schema',
      },
    ];

    expect(inferSchemaForNodeOutput(nodes[1], 'data', nodes, edges)).toEqual({
      type: 'object',
      properties: {
        completion: { type: 'integer' },
        quality: { type: 'integer' },
      },
      required: ['completion', 'quality'],
    });
  });

  it('infers Add Schema Fields output without modifying existing fields', () => {
    const baseSchema = nodeData('json_schema');
    baseSchema.literalValue = {
      type: 'object',
      title: 'Evaluation',
      properties: { score: { type: 'number' } },
      required: ['score'],
      additionalProperties: false,
    };

    const editSchema = nodeData('edit_json_schema');
    editSchema.literalValue = {
      type: 'object',
      properties: {
        score: { type: 'integer' },
        verdict: { type: 'string', enum: ['pass', 'fail'] },
      },
      required: ['score', 'verdict'],
    };

    const nodes = [
      { id: 'base', type: 'json_schema', position: { x: 0, y: 0 }, data: baseSchema },
      { id: 'edit', type: 'edit_json_schema', position: { x: 200, y: 0 }, data: editSchema },
    ];
    const edges = [
      {
        id: 'schema-edge',
        source: 'base',
        sourceHandle: 'value',
        target: 'edit',
        targetHandle: 'schema',
      },
    ];

    expect(inferSchemaForNodeOutput(nodes[1], 'schema', nodes, edges)).toEqual({
      type: 'object',
      title: 'Evaluation',
      properties: {
        score: { type: 'number' },
        verdict: { type: 'string', enum: ['pass', 'fail'] },
      },
      required: ['score', 'verdict'],
      additionalProperties: false,
    });
  });
});
