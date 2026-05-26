export type MediaPinDirection = 'input' | 'output';

export type PinLike = {
  id: string;
  type?: string;
};

const MEDIA_NODE_TYPES = [
  'generate_image',
  'edit_image',
  'image_to_image',
  'generate_video',
  'text_to_video',
  'image_to_video',
  'generate_voice',
  'generate_music',
  'transcribe_audio',
  'listen_voice',
];

const ADVANCED_INPUT_PINS: Record<string, string[]> = {
  generate_image: ['seed', 'steps', 'guidance_scale', 'negative_prompt'],
  edit_image: ['seed', 'steps', 'guidance_scale', 'negative_prompt', 'extra'],
  image_to_image: ['mask_artifact', 'seed', 'steps', 'guidance_scale', 'negative_prompt', 'extra'],
  generate_video: ['seed', 'steps', 'guidance_scale', 'negative_prompt', 'extra'],
  text_to_video: ['seed', 'steps', 'guidance_scale', 'negative_prompt', 'extra'],
  image_to_video: ['seed', 'steps', 'guidance_scale', 'strength', 'negative_prompt', 'extra'],
  generate_voice: ['profile', 'instructions'],
  generate_music: [
    'seed',
    'num_inference_steps',
    'guidance_scale',
    'enhance_prompt',
    'structure_prompt',
    'auto_lyrics',
    'text_planner_mode',
    'vocal_language',
    'negative_prompt',
    'sample_rate',
    'bpm',
    'keyscale',
    'timesignature',
    'composition_plan',
    'positive_styles',
    'negative_styles',
    'planning',
    'extra',
  ],
  transcribe_audio: ['prompt', 'temperature'],
  listen_voice: ['wait_key'],
};

const ADVANCED_OUTPUT_PINS: Record<string, string[]> = {
  generate_image: ['artifact_ref', 'artifact_id', 'content_type', 'outputs', 'meta'],
  edit_image: ['artifact_ref', 'artifact_id', 'content_type', 'outputs', 'meta'],
  image_to_image: ['artifact_ref', 'artifact_id', 'content_type', 'outputs', 'meta'],
  generate_video: ['artifact_ref', 'artifact_id', 'content_type', 'outputs', 'meta'],
  text_to_video: ['artifact_ref', 'artifact_id', 'content_type', 'outputs', 'meta'],
  image_to_video: ['artifact_ref', 'artifact_id', 'content_type', 'outputs', 'meta'],
  generate_voice: ['artifact_ref', 'artifact_id', 'content_type', 'outputs', 'meta'],
  generate_music: ['artifact_ref', 'artifact_id', 'content_type', 'outputs', 'meta'],
  transcribe_audio: ['transcript_artifact', 'artifact_ref', 'artifact_id', 'meta'],
  listen_voice: ['artifact_ref', 'artifact_id'],
};

function pinMap(direction: MediaPinDirection): Record<string, string[]> {
  return direction === 'input' ? ADVANCED_INPUT_PINS : ADVANCED_OUTPUT_PINS;
}

export function isMediaNodeType(nodeType: string): boolean {
  return MEDIA_NODE_TYPES.includes(nodeType);
}

export function advancedMediaPinIds(nodeType: string, direction: MediaPinDirection): string[] {
  return pinMap(direction)[nodeType] || [];
}

export function isAdvancedMediaPin(nodeType: string, pinId: string, direction: MediaPinDirection): boolean {
  return advancedMediaPinIds(nodeType, direction).includes(pinId);
}

export function getVisibleMediaPins<T extends PinLike>(
  nodeType: string,
  direction: MediaPinDirection,
  pins: readonly T[],
  connectedPinIds: ReadonlySet<string>,
  showAdvanced: boolean
): T[] {
  if (!isMediaNodeType(nodeType)) return Array.from(pins);
  return pins.filter((pin) => {
    if (pin.type === 'execution') return true;
    if (!isAdvancedMediaPin(nodeType, pin.id, direction)) return true;
    return showAdvanced || connectedPinIds.has(pin.id);
  });
}

export function countAdvancedMediaPins(
  nodeType: string,
  direction: MediaPinDirection,
  pins: readonly PinLike[]
): number {
  if (!isMediaNodeType(nodeType)) return 0;
  return pins.filter((pin) => pin.type !== 'execution' && isAdvancedMediaPin(nodeType, pin.id, direction)).length;
}

export function countHiddenAdvancedMediaPins(
  nodeType: string,
  direction: MediaPinDirection,
  pins: readonly PinLike[],
  connectedPinIds: ReadonlySet<string>,
  showAdvanced: boolean
): number {
  if (showAdvanced || !isMediaNodeType(nodeType)) return 0;
  return pins.filter(
    (pin) => pin.type !== 'execution' && isAdvancedMediaPin(nodeType, pin.id, direction) && !connectedPinIds.has(pin.id)
  ).length;
}
