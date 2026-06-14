import { describe, expect, it } from 'vitest';

import {
  EDITOR_DATA_PIN_TYPES,
  FLOW_IO_EDITOR_DATA_PIN_TYPES,
  FLOW_IO_ARRAY_ITEM_TYPES,
  VAR_DECL_PIN_TYPE_OPTIONS,
  buildFileArraySchema,
  dataPinTypeLabel,
  displayDataPinTypeLabel,
  editorDisplayPinType,
  fileArrayItemTypeForPin,
  flowIoEditorDisplayPinType,
  flowIoArrayItemTypeForPin,
  flowIoPinPatchForArrayItem,
  flowIoPinTypeLabel,
  flowBoundaryPinSelectionHint,
  isVarDeclPinType,
} from './pinTypeOptions';

describe('pinTypeOptions', () => {
  it('keeps Flow Start and Flow End editor types focused on plain boundary choices while arrays carry item types', () => {
    expect(EDITOR_DATA_PIN_TYPES).toEqual(
      expect.arrayContaining([
        'artifact',
        'artifact_text',
        'array',
        'workspace_file',
        'workspace_folder',
      ])
    );
    expect(EDITOR_DATA_PIN_TYPES).not.toEqual(expect.arrayContaining(['artifacts', 'artifacts_image']));
    expect(FLOW_IO_EDITOR_DATA_PIN_TYPES).toEqual(
      expect.arrayContaining(['artifact', 'array', 'workspace_file', 'workspace_folder'])
    );
    expect(FLOW_IO_EDITOR_DATA_PIN_TYPES).not.toEqual(
      expect.arrayContaining(['artifact_text', 'artifact_image', 'artifact_audio', 'artifact_video'])
    );
    expect(FLOW_IO_ARRAY_ITEM_TYPES).toEqual(
      expect.arrayContaining(['any', 'string', 'number', 'artifact', 'workspace_file', 'workspace_folder', 'agent'])
    );
  });

  it('labels internal artifact-list compatibility types as array in the editor', () => {
    expect(dataPinTypeLabel('artifact')).toBe('file');
    expect(dataPinTypeLabel('artifacts')).toBe('array');
    expect(dataPinTypeLabel('artifacts_text')).toBe('array');
    expect(dataPinTypeLabel('workspace_folder')).toBe('server folder');
  });

  it('derives file-array editor state from array schema and legacy artifact list pins', () => {
    expect(editorDisplayPinType({ type: 'artifacts_text' as any })).toBe('array');
    expect(fileArrayItemTypeForPin({ type: 'artifacts_text' as any })).toBe('artifact_text');
    expect(fileArrayItemTypeForPin({ type: 'array', schema: buildFileArraySchema('artifact_image') })).toBe('artifact_image');
    expect(flowIoEditorDisplayPinType({ type: 'artifact_text' as any })).toBe('artifact');
    expect(flowIoArrayItemTypeForPin({ type: 'artifacts_text' as any })).toBe('artifact_text');
    expect(flowIoArrayItemTypeForPin(flowIoPinPatchForArrayItem({ type: 'array' as any }, 'string'))).toBe('string');
  });

  it('shows array-aligned labels for boundary inputs and legacy artifact arrays', () => {
    const fileArrayPin = flowIoPinPatchForArrayItem({ type: 'array' as any }, 'artifact');
    const stringArrayPin = flowIoPinPatchForArrayItem({ type: 'array' as any }, 'string');
    expect(displayDataPinTypeLabel({ type: 'artifact_text' as any })).toBe('file');
    expect(displayDataPinTypeLabel(fileArrayPin)).toBe('array<file>');
    expect(displayDataPinTypeLabel(stringArrayPin)).toBe('array<string>');
    expect(displayDataPinTypeLabel({ type: 'array', schema: buildFileArraySchema('artifact_text') })).toBe('array<text file>');
    expect(displayDataPinTypeLabel({ type: 'workspace_folder' as any })).toBe('server folder');
  });

  it('explains how On Flow Start and On Flow End file arrays and server folders behave', () => {
    const fileArrayPin = flowIoPinPatchForArrayItem({ type: 'array' as any }, 'artifact');
    const stringArrayPin = flowIoPinPatchForArrayItem({ type: 'array' as any }, 'string');
    expect(flowBoundaryPinSelectionHint({ type: 'artifact' as any }, 'start')).toBe(
      'Run form choices: Artifact, Local File, or Server File.'
    );
    expect(flowBoundaryPinSelectionHint(fileArrayPin, 'start')).toBe(
      'Run form choices: Artifacts, Local Files, or Local Folder. Local Folder expands into files with relative paths preserved. Use Server Folder when the workflow needs a live writable folder path.'
    );
    expect(flowBoundaryPinSelectionHint({ type: 'array' as any }, 'start')).toBe(
      'Generic array input. Set the item type to file when users should pick multiple local files or a local folder from this computer.'
    );
    expect(flowBoundaryPinSelectionHint(stringArrayPin, 'start')).toBe(
      'Run form value: a JSON array of string values.'
    );
    expect(flowBoundaryPinSelectionHint({ type: 'workspace_folder' as any }, 'start')).toBe(
      'Run form choice: Server Folder path from the allowed workspace.'
    );
    expect(flowBoundaryPinSelectionHint(fileArrayPin, 'end')).toBe(
      'Returns an array of saved files from the workflow.'
    );
  });

  it('uses array wording in the Flow Start and Flow End picker', () => {
    expect(flowIoPinTypeLabel('artifact')).toBe('file');
    expect(flowIoPinTypeLabel('array')).toBe('array');
    expect(flowIoPinTypeLabel('workspace_folder')).toBe('server folder');
  });

  it('accepts artifact and workspace variable declarations without drifting from the shared catalog', () => {
    expect(isVarDeclPinType('artifact')).toBe(true);
    expect(isVarDeclPinType('artifacts')).toBe(true);
    expect(isVarDeclPinType('workspace_file')).toBe(true);
    expect(isVarDeclPinType('execution')).toBe(false);
    expect(VAR_DECL_PIN_TYPE_OPTIONS).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ value: 'artifact' }),
        expect.objectContaining({ value: 'artifacts' }),
        expect.objectContaining({ value: 'array' }),
        expect.objectContaining({ value: 'workspace_folder' }),
      ])
    );
  });
});
