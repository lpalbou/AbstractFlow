import { describe, expect, it } from 'vitest';
import { gatewayPinTypeToVisualPinType, normalizeRunInputData } from './gatewayInputSchema';

describe('gateway input schema helpers', () => {
  it('preserves json_schema pin types from gateway metadata', () => {
    expect(gatewayPinTypeToVisualPinType({ id: 'criteria', type: 'json_schema' })).toBe('json_schema');
  });

  it('coerces json_schema string input defaults as JSON objects', () => {
    const normalized = normalizeRunInputData(
      { criteria: '{"type":"object","properties":{"score":{"type":"number"}}}' },
      { inputs: [{ id: 'criteria', type: 'json_schema' }] }
    );

    expect(normalized.inputData.criteria).toEqual({
      type: 'object',
      properties: { score: { type: 'number' } },
    });
  });

  it('preserves artifact pin types from gateway metadata', () => {
    expect(gatewayPinTypeToVisualPinType({ id: 'source', type: 'artifact_image' })).toBe('artifact_image');
    expect(gatewayPinTypeToVisualPinType({ id: 'audio', type: 'artifact_audio' })).toBe('artifact_audio');
    expect(gatewayPinTypeToVisualPinType({ id: 'files', type: 'artifacts_text' })).toBe('artifacts_text');
  });

  it('normalizes artifact pin strings into canonical artifact refs', () => {
    const normalized = normalizeRunInputData(
      { source: 'img-123' },
      { inputs: [{ id: 'source', type: 'artifact_image' }] }
    );

    expect(normalized.inputData.source).toEqual({ $artifact: 'img-123', artifact_id: 'img-123' });
  });

  it('normalizes artifact pin JSON text without dropping owner run metadata', () => {
    const normalized = normalizeRunInputData(
      { source: '{"artifact_id":"img-123","run_id":"run-1","content_type":"image/png"}' },
      { inputs: [{ id: 'source', type: 'artifact_image' }] }
    );

    expect(normalized.inputData.source).toEqual({
      $artifact: 'img-123',
      artifact_id: 'img-123',
      run_id: 'run-1',
      content_type: 'image/png',
    });
  });

  it('normalizes artifact list pin strings into canonical artifact-ref arrays', () => {
    const normalized = normalizeRunInputData(
      {
        files: '[{"artifact_id":"doc-1","run_id":"run-1"},{"$artifact":"doc-2","content_type":"text/plain"}]',
      },
      { inputs: [{ id: 'files', type: 'artifacts_text' }] }
    );

    expect(normalized.inputData.files).toEqual([
      { $artifact: 'doc-1', artifact_id: 'doc-1', run_id: 'run-1' },
      { $artifact: 'doc-2', artifact_id: 'doc-2', content_type: 'text/plain' },
    ]);
  });
});
