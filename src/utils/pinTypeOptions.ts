import type { Pin, PinType } from '../types/flow';

export const EDITOR_DATA_PIN_TYPES = [
  'string',
  'number',
  'boolean',
  'object',
  'json_schema',
  'artifact',
  'artifact_image',
  'artifact_audio',
  'artifact_text',
  'artifact_video',
  'workspace_file',
  'workspace_folder',
  'memory',
  'assertion',
  'assertions',
  'array',
  'tools',
  'provider_text',
  'provider_image',
  'provider_voice',
  'provider_music',
  'provider',
  'model',
  'agent',
  'any',
] as const satisfies readonly Exclude<PinType, 'execution'>[];

export type EditorDataPinType = (typeof EDITOR_DATA_PIN_TYPES)[number];

export const FLOW_IO_EDITOR_DATA_PIN_TYPES = [
  'string',
  'number',
  'boolean',
  'object',
  'json_schema',
  'artifact',
  'workspace_file',
  'workspace_folder',
  'memory',
  'assertion',
  'assertions',
  'array',
  'tools',
  'provider_text',
  'provider_image',
  'provider_voice',
  'provider_music',
  'provider',
  'model',
  'agent',
  'any',
] as const satisfies readonly EditorDataPinType[];

export type FlowIoEditorDataPinType = (typeof FLOW_IO_EDITOR_DATA_PIN_TYPES)[number];

export const FILE_ARRAY_ITEM_TYPES = [
  'any',
  'artifact',
  'artifact_image',
  'artifact_audio',
  'artifact_text',
  'artifact_video',
] as const;

export type FileArrayItemType = (typeof FILE_ARRAY_ITEM_TYPES)[number];

export const FLOW_IO_ARRAY_ITEM_TYPES = [
  'any',
  'string',
  'number',
  'boolean',
  'object',
  'json_schema',
  'artifact',
  'artifact_image',
  'artifact_audio',
  'artifact_text',
  'artifact_video',
  'workspace_file',
  'workspace_folder',
  'memory',
  'assertion',
  'assertions',
  'tools',
  'provider_text',
  'provider_image',
  'provider_voice',
  'provider_music',
  'provider',
  'model',
  'agent',
] as const;

export type FlowIoArrayItemType = (typeof FLOW_IO_ARRAY_ITEM_TYPES)[number];

type FlowIoFolderShape = 'folder' | 'folders';
const FLOW_IO_FOLDER_SHAPE_KEY = 'x-abstract-flow-io-folder-shape';
const FLOW_IO_ARRAY_ITEM_TYPE_KEY = 'x-abstract-flow-io-items-type';

const ARTIFACT_ARRAY_TYPE_BY_ITEM: Record<Exclude<FileArrayItemType, 'any'>, PinType> = {
  artifact: 'artifacts',
  artifact_image: 'artifacts_image',
  artifact_audio: 'artifacts_audio',
  artifact_text: 'artifacts_text',
  artifact_video: 'artifacts_video',
};

export function artifactListTypeForArrayItemType(itemType: FileArrayItemType): PinType | 'array' {
  return itemType === 'any' ? 'array' : ARTIFACT_ARRAY_TYPE_BY_ITEM[itemType];
}

function recordFrom(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function stringFrom(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function flowIoFolderShapeFromSchema(schema: Record<string, unknown> | undefined): FlowIoFolderShape | null {
  const record = recordFrom(schema);
  if (!record) return null;
  const explicit = stringFrom(record[FLOW_IO_FOLDER_SHAPE_KEY]);
  return explicit === 'folder' || explicit === 'folders' ? explicit : null;
}

function artifactArrayItemTypeFromSchema(schema: Record<string, unknown> | undefined): FileArrayItemType {
  const record = recordFrom(schema);
  if (!record) return 'any';
  const explicit = stringFrom(record['x-abstract-items-type']);
  if (explicit === 'artifact' || explicit === 'artifact_image' || explicit === 'artifact_audio' || explicit === 'artifact_text' || explicit === 'artifact_video') {
    return explicit;
  }
  const abstractType = stringFrom(record['x-abstract-type']);
  if (abstractType === 'artifacts') return 'artifact';
  if (abstractType === 'artifacts_image') return 'artifact_image';
  if (abstractType === 'artifacts_audio') return 'artifact_audio';
  if (abstractType === 'artifacts_text') return 'artifact_text';
  if (abstractType === 'artifacts_video') return 'artifact_video';
  const items = recordFrom(record.items);
  if (!items) return 'any';
  const itemsType = stringFrom(items['x-abstract-type']);
  if (itemsType === 'artifact') return 'artifact';
  if (itemsType === 'artifact_image') return 'artifact_image';
  if (itemsType === 'artifact_audio') return 'artifact_audio';
  if (itemsType === 'artifact_text') return 'artifact_text';
  if (itemsType === 'artifact_video') return 'artifact_video';
  const modality = stringFrom(items['x-abstract-artifact-modality']);
  if (modality === 'image') return 'artifact_image';
  if (modality === 'audio') return 'artifact_audio';
  if (modality === 'text') return 'artifact_text';
  if (modality === 'video') return 'artifact_video';
  const properties = recordFrom(items.properties);
  const artifactProperty = properties ? recordFrom(properties.$artifact) : null;
  if (stringFrom(artifactProperty?.type) === 'string') return 'artifact';
  return 'any';
}

export function fileArrayItemTypeForPin(pin: Pick<Pin, 'type' | 'schema'>): FileArrayItemType {
  if (pin.type === 'artifacts') return 'artifact';
  if (pin.type === 'artifacts_image') return 'artifact_image';
  if (pin.type === 'artifacts_audio') return 'artifact_audio';
  if (pin.type === 'artifacts_text') return 'artifact_text';
  if (pin.type === 'artifacts_video') return 'artifact_video';
  if (pin.type !== 'array') return 'any';
  return artifactArrayItemTypeFromSchema(pin.schema);
}

export function editorDisplayPinType(pin: Pick<Pin, 'type' | 'schema'>): EditorDataPinType {
  if (
    pin.type === 'artifacts' ||
    pin.type === 'artifacts_image' ||
    pin.type === 'artifacts_audio' ||
    pin.type === 'artifacts_text' ||
    pin.type === 'artifacts_video'
  ) {
    return 'array';
  }
  return pin.type as EditorDataPinType;
}

export function flowIoEditorDisplayPinType(pin: Pick<Pin, 'type' | 'schema'>): FlowIoEditorDataPinType {
  const display = editorDisplayPinType(pin);
  if (display === 'artifact_image' || display === 'artifact_audio' || display === 'artifact_text' || display === 'artifact_video') {
    return 'artifact';
  }
  return display as FlowIoEditorDataPinType;
}

export function fileArrayItemTypeLabel(value: FileArrayItemType): string {
  if (value === 'any') return 'any';
  return dataPinTypeLabel(value);
}

export function flowIoArrayItemTypeForPin(pin: Pick<Pin, 'type' | 'schema'>): FlowIoArrayItemType {
  if (pin.type === 'artifacts') return 'artifact';
  if (pin.type === 'artifacts_image') return 'artifact_image';
  if (pin.type === 'artifacts_audio') return 'artifact_audio';
  if (pin.type === 'artifacts_text') return 'artifact_text';
  if (pin.type === 'artifacts_video') return 'artifact_video';
  if (pin.type !== 'array') return 'any';
  const schema = recordFrom(pin.schema);
  const explicit = stringFrom(schema?.[FLOW_IO_ARRAY_ITEM_TYPE_KEY]);
  if (FLOW_IO_ARRAY_ITEM_TYPES.includes(explicit as FlowIoArrayItemType)) {
    return explicit as FlowIoArrayItemType;
  }
  if (flowIoFolderShapeFromSchema(pin.schema)) {
    return 'artifact';
  }
  const fileItem = fileArrayItemTypeForPin(pin);
  if (fileItem !== 'any') return fileItem as FlowIoArrayItemType;
  const items = recordFrom(schema?.items);
  const abstractType = stringFrom(items?.['x-abstract-type']);
  if (FLOW_IO_ARRAY_ITEM_TYPES.includes(abstractType as FlowIoArrayItemType)) {
    return abstractType as FlowIoArrayItemType;
  }
  const itemsType = stringFrom(items?.type);
  if (itemsType === 'string') return 'string';
  if (itemsType === 'number' || itemsType === 'integer') return 'number';
  if (itemsType === 'boolean') return 'boolean';
  if (itemsType === 'array') return 'tools';
  if (itemsType === 'object') return 'object';
  return 'any';
}

export function flowIoArrayItemTypeLabel(value: FlowIoArrayItemType): string {
  if (value === 'any') return 'any';
  return dataPinTypeLabel(value);
}

export function fileArrayDisplayLabel(value: FileArrayItemType): string {
  if (value === 'any') return 'list';
  if (value === 'artifact') return 'file list';
  if (value === 'artifact_image') return 'image file list';
  if (value === 'artifact_audio') return 'audio file list';
  if (value === 'artifact_text') return 'text file list';
  if (value === 'artifact_video') return 'video file list';
  return 'list';
}

export function flowIoPinTypeLabel(type: FlowIoEditorDataPinType | string): string {
  if (type === 'array') return 'array';
  return dataPinTypeLabel(type);
}

export function buildFileArraySchema(itemType: FileArrayItemType): Record<string, unknown> | undefined {
  if (itemType === 'any') return undefined;
  const artifactType = itemType;
  const modality =
    artifactType === 'artifact_image'
      ? 'image'
      : artifactType === 'artifact_audio'
        ? 'audio'
        : artifactType === 'artifact_text'
          ? 'text'
          : artifactType === 'artifact_video'
            ? 'video'
            : '';
  const items: Record<string, unknown> = {
    type: 'object',
    additionalProperties: true,
    required: ['$artifact'],
    properties: {
      $artifact: { type: 'string', minLength: 1 },
      artifact_id: { type: 'string' },
      run_id: { type: 'string' },
      artifact_run_id: { type: 'string' },
      content_type: { type: 'string' },
      filename: { type: 'string' },
      source_path: { type: 'string' },
      modality: { type: 'string' },
    },
    'x-abstract-type': artifactType,
  };
  if (modality) items['x-abstract-artifact-modality'] = modality;
  return {
    type: 'array',
    items,
    'x-abstract-type': ARTIFACT_ARRAY_TYPE_BY_ITEM[itemType],
    'x-abstract-items-type': itemType,
    ...(modality ? { 'x-abstract-artifact-modality': modality } : {}),
  };
}

function buildFlowIoArraySchema(itemType: FlowIoArrayItemType): Record<string, unknown> | undefined {
  if (itemType === 'any') return undefined;
  if (
    itemType === 'artifact' ||
    itemType === 'artifact_image' ||
    itemType === 'artifact_audio' ||
    itemType === 'artifact_text' ||
    itemType === 'artifact_video'
  ) {
    return {
      ...buildFileArraySchema(itemType),
      [FLOW_IO_ARRAY_ITEM_TYPE_KEY]: itemType,
    };
  }
  const primitiveType =
    itemType === 'string' ||
    itemType === 'workspace_file' ||
    itemType === 'workspace_folder' ||
    itemType === 'provider' ||
    itemType === 'provider_text' ||
    itemType === 'provider_image' ||
    itemType === 'provider_voice' ||
    itemType === 'provider_music' ||
    itemType === 'model' ||
    itemType === 'agent'
      ? 'string'
      : itemType === 'number'
        ? 'number'
        : itemType === 'boolean'
          ? 'boolean'
          : itemType === 'tools' || itemType === 'assertions'
            ? 'array'
            : 'object';
  const items: Record<string, unknown> = {
    type: primitiveType,
    'x-abstract-type': itemType,
  };
  if (primitiveType === 'object') items.additionalProperties = true;
  return {
    type: 'array',
    items,
    [FLOW_IO_ARRAY_ITEM_TYPE_KEY]: itemType,
  };
}

export function pinPatchForEditorSelection(
  current: Pick<Pin, 'type' | 'schema'>,
  nextType: EditorDataPinType
): Pick<Pin, 'type' | 'schema'> {
  if (nextType === 'array') {
    const currentItemType = fileArrayItemTypeForPin(current);
    return {
      type: 'array',
      schema: currentItemType === 'any' ? (current.type === 'array' ? current.schema : undefined) : buildFileArraySchema(currentItemType),
    };
  }
  return { type: nextType, schema: undefined };
}

export function flowIoPinPatchForEditorSelection(
  current: Pick<Pin, 'type' | 'schema'>,
  nextType: FlowIoEditorDataPinType
): Pick<Pin, 'type' | 'schema'> {
  if (nextType === 'array') {
    const currentItemType = flowIoArrayItemTypeForPin(current);
    return {
      type: 'array',
      schema: currentItemType === 'any' ? (current.type === 'array' ? current.schema : undefined) : buildFlowIoArraySchema(currentItemType),
    };
  }
  return { type: nextType, schema: undefined };
}

export function pinPatchForFileArrayItem(
  _current: Pick<Pin, 'type' | 'schema'>,
  itemType: FileArrayItemType
): Pick<Pin, 'type' | 'schema'> {
  return {
    type: 'array',
    schema: buildFileArraySchema(itemType),
  };
}

export function flowIoPinPatchForArrayItem(
  _current: Pick<Pin, 'type' | 'schema'>,
  itemType: FlowIoArrayItemType
): Pick<Pin, 'type' | 'schema'> {
  return {
    type: 'array',
    schema: buildFlowIoArraySchema(itemType),
  };
}

export function displayDataPinTypeLabel(pin: Pick<Pin, 'type' | 'schema'> | undefined | null): string {
  if (!pin) return 'any';
  if (
    pin.type === 'artifact' ||
    pin.type === 'artifact_image' ||
    pin.type === 'artifact_audio' ||
    pin.type === 'artifact_text' ||
    pin.type === 'artifact_video'
  ) {
    return 'file';
  }
  if (pin.type === 'array') {
    const itemType = flowIoArrayItemTypeForPin(pin);
    return itemType === 'any' ? 'array' : `array<${dataPinTypeLabel(itemType)}>`;
  }
  if (
    pin.type === 'artifacts' ||
    pin.type === 'artifacts_image' ||
    pin.type === 'artifacts_audio' ||
    pin.type === 'artifacts_text' ||
    pin.type === 'artifacts_video'
  ) {
    return `array<${dataPinTypeLabel(fileArrayItemTypeForPin(pin))}>`;
  }
  return dataPinTypeLabel(pin.type);
}

export function flowBoundaryPinSelectionHint(
  pin: Pick<Pin, 'type' | 'schema'>,
  boundary: 'start' | 'end'
): string | null {
  const flowIoItemType = flowIoArrayItemTypeForPin(pin);
  if (boundary === 'start') {
    if (
      pin.type === 'artifact' ||
      pin.type === 'artifact_image' ||
      pin.type === 'artifact_audio' ||
      pin.type === 'artifact_text' ||
      pin.type === 'artifact_video'
    ) {
      return 'Run form choices: Artifact, Local File, or Server File.';
    }
    if (pin.type === 'array' && flowIoItemType === 'any') {
      return 'Generic array input. Set the item type to file when users should pick multiple local files or a local folder from this computer.';
    }
    if (
      pin.type === 'artifacts' ||
      pin.type === 'artifacts_image' ||
      pin.type === 'artifacts_audio' ||
      pin.type === 'artifacts_text' ||
      pin.type === 'artifacts_video' ||
      (pin.type === 'array' &&
        (flowIoItemType === 'artifact' ||
          flowIoItemType === 'artifact_image' ||
          flowIoItemType === 'artifact_audio' ||
          flowIoItemType === 'artifact_text' ||
          flowIoItemType === 'artifact_video'))
    ) {
      return 'Run form choices: Artifacts, Local Files, or Local Folder. Local Folder expands into files with relative paths preserved. Use Server Folder when the workflow needs a live writable folder path.';
    }
    if (pin.type === 'workspace_file') {
      return 'Run form choice: Server File path from the allowed workspace.';
    }
    if (pin.type === 'workspace_folder') {
      return 'Run form choice: Server Folder path from the allowed workspace.';
    }
    if (pin.type === 'array') {
      return `Run form value: a JSON array of ${dataPinTypeLabel(flowIoItemType)} values.`;
    }
    return null;
  }

  if (
    pin.type === 'artifact' ||
    pin.type === 'artifact_image' ||
    pin.type === 'artifact_audio' ||
    pin.type === 'artifact_text' ||
    pin.type === 'artifact_video'
  ) {
    return 'Returns one saved file from the workflow.';
  }
  if (
    pin.type === 'artifacts' ||
    pin.type === 'artifacts_image' ||
      pin.type === 'artifacts_audio' ||
      pin.type === 'artifacts_text' ||
      pin.type === 'artifacts_video' ||
      (pin.type === 'array' &&
        (flowIoItemType === 'artifact' ||
          flowIoItemType === 'artifact_image' ||
          flowIoItemType === 'artifact_audio' ||
          flowIoItemType === 'artifact_text' ||
          flowIoItemType === 'artifact_video'))
  ) {
    return 'Returns an array of saved files from the workflow.';
  }
  if (pin.type === 'workspace_file') {
    return 'Returns one live server file path.';
  }
  if (pin.type === 'workspace_folder') {
    return 'Returns one live server folder path.';
  }
  if (pin.type === 'array' && flowIoItemType !== 'any') {
    return `Returns an array of ${dataPinTypeLabel(flowIoItemType)} values.`;
  }
  return null;
}

export function dataPinTypeLabel(type: PinType | string): string {
  if (type === 'object') return 'json';
  if (type === 'json_schema') return 'json schema';
  if (type === 'artifact') return 'file';
  if (type === 'artifact_image') return 'image file';
  if (type === 'artifact_audio') return 'audio file';
  if (type === 'artifact_text') return 'text file';
  if (type === 'artifact_video') return 'video file';
  if (type === 'artifacts' || type === 'artifacts_image' || type === 'artifacts_audio' || type === 'artifacts_text' || type === 'artifacts_video') return 'array';
  if (type === 'workspace_file') return 'server file';
  if (type === 'workspace_folder') return 'server folder';
  if (type === 'provider_text') return 'text provider';
  if (type === 'provider_image') return 'image provider';
  if (type === 'provider_voice') return 'voice provider';
  if (type === 'provider_music') return 'music provider';
  return type;
}

export const VAR_DECL_PIN_TYPES = [
  'boolean',
  'number',
  'string',
  'artifact',
  'artifact_image',
  'artifact_audio',
  'artifact_text',
  'artifact_video',
  'artifacts',
  'artifacts_image',
  'artifacts_audio',
  'artifacts_text',
  'artifacts_video',
  'provider_text',
  'model_text',
  'provider_image',
  'model_image',
  'provider_video',
  'model_video',
  'provider_voice',
  'model_voice',
  'provider_music',
  'model_music',
  'provider',
  'model',
  'workspace_file',
  'workspace_folder',
  'object',
  'json_schema',
  'assertion',
  'assertions',
  'array',
  'tools',
  'any',
] as const satisfies readonly Exclude<PinType, 'execution'>[];

export type VarDeclPinType = (typeof VAR_DECL_PIN_TYPES)[number];

const VAR_DECL_PIN_TYPE_SET = new Set<string>(VAR_DECL_PIN_TYPES);

export function isVarDeclPinType(value: string): value is VarDeclPinType {
  return VAR_DECL_PIN_TYPE_SET.has(value);
}

export const VAR_DECL_PIN_TYPE_OPTIONS: Array<{ value: VarDeclPinType; label: string }> = VAR_DECL_PIN_TYPES.map((value) => ({
  value,
  label: dataPinTypeLabel(value),
}));
