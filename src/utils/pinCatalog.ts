import type { NodeType, Pin } from '../types/flow';

export type PinCatalogScope = 'text' | 'image' | 'tts' | 'stt' | 'music';

const TEXT_NODE_TYPES = new Set<NodeType>(['agent', 'llm_call', 'provider_catalog', 'provider_models']);
const IMAGE_NODE_TYPES = new Set<NodeType>(['generate_image', 'edit_image', 'image_to_image', 'generate_video', 'text_to_video', 'image_to_video']);
const TTS_NODE_TYPES = new Set<NodeType>(['generate_voice']);
const STT_NODE_TYPES = new Set<NodeType>(['listen_voice', 'transcribe_audio']);
const MUSIC_NODE_TYPES = new Set<NodeType>(['generate_music']);

function scopeForNodeType(nodeType?: NodeType): PinCatalogScope | null {
  if (!nodeType) return null;
  if (IMAGE_NODE_TYPES.has(nodeType)) return 'image';
  if (TTS_NODE_TYPES.has(nodeType)) return 'tts';
  if (STT_NODE_TYPES.has(nodeType)) return 'stt';
  if (MUSIC_NODE_TYPES.has(nodeType)) return 'music';
  if (TEXT_NODE_TYPES.has(nodeType)) return 'text';
  return null;
}

function prefixFromId(pinId: string, suffix: '_provider' | '_model'): string {
  return pinId.endsWith(suffix) ? pinId.slice(0, -suffix.length) : '';
}

function scopeFromPrefix(prefix: string): PinCatalogScope | null {
  if (prefix === 'image') return 'image';
  if (prefix === 'video') return 'image';
  if (prefix === 'tts' || prefix === 'voice') return 'tts';
  if (prefix === 'stt' || prefix === 'speech' || prefix === 'transcription') return 'stt';
  if (prefix === 'music' || prefix === 'sound') return 'music';
  if (prefix === 'text' || prefix === 'llm') return 'text';
  return null;
}

export function isProviderPin(pin: Pin): boolean {
  return (
    pin.type === 'provider' ||
    pin.type === 'provider_text' ||
    pin.type === 'provider_image' ||
    pin.type === 'provider_video' ||
    pin.type === 'provider_voice' ||
    pin.type === 'provider_music' ||
    pin.id === 'provider' ||
    pin.id.endsWith('_provider')
  );
}

export function isModelPin(pin: Pin): boolean {
  return (
    pin.type === 'model' ||
    pin.type === 'model_text' ||
    pin.type === 'model_image' ||
    pin.type === 'model_video' ||
    pin.type === 'model_voice' ||
    pin.type === 'model_music' ||
    pin.id === 'model' ||
    pin.id.endsWith('_model')
  );
}

export function providerCatalogScopeForPin(pin: Pin, nodeType?: NodeType): PinCatalogScope | null {
  if (!isProviderPin(pin)) return null;
  if (pin.id === 'image_provider' || pin.id === 'provider_image' || pin.type === 'provider_image') return 'image';
  if (pin.id === 'video_provider' || pin.id === 'provider_video' || pin.type === 'provider_video') return 'image';
  if (pin.id === 'tts_provider') return 'tts';
  if (pin.id === 'stt_provider') return 'stt';
  if (pin.id === 'music_provider' || pin.id === 'provider_music' || pin.type === 'provider_music') return 'music';
  if (pin.type === 'provider_voice' || pin.id === 'provider_voice') return scopeForNodeType(nodeType) || 'tts';
  if (pin.type === 'provider' || pin.type === 'provider_text' || pin.id === 'provider') return scopeForNodeType(nodeType) || 'text';
  return scopeFromPrefix(prefixFromId(pin.id, '_provider')) || scopeForNodeType(nodeType) || 'text';
}

export function modelCatalogScopeForPin(pin: Pin, pins: Pin[], nodeType?: NodeType): PinCatalogScope | null {
  if (!isModelPin(pin)) return null;
  if (pin.id === 'image_model' || pin.id === 'model_image' || pin.type === 'model_image') return 'image';
  if (pin.id === 'video_model' || pin.id === 'model_video' || pin.type === 'model_video') return 'image';
  if (pin.id === 'tts_model') return 'tts';
  if (pin.id === 'stt_model') return 'stt';
  if (pin.id === 'music_model' || pin.id === 'model_music' || pin.type === 'model_music') return 'music';
  if (pin.type === 'model_voice' || pin.id === 'model_voice') return scopeForNodeType(nodeType) || 'tts';
  if (pin.type === 'model_text' || pin.id === 'model_text') return 'text';

  const prefixScope = scopeFromPrefix(prefixFromId(pin.id, '_model'));
  if (prefixScope) return prefixScope;

  const providerScopes = new Set<PinCatalogScope>();
  for (const candidate of pins) {
    const scope = providerCatalogScopeForPin(candidate, nodeType);
    if (scope) providerScopes.add(scope);
  }
  if (providerScopes.size === 1) return Array.from(providerScopes)[0];

  return scopeForNodeType(nodeType) || 'text';
}

export function providerPinIdForModelPin(pin: Pin, pins: Pin[], nodeType?: NodeType): string | null {
  if (!isModelPin(pin)) return null;

  const prefix = prefixFromId(pin.id, '_model');
  if (prefix) {
    const exact = `${prefix}_provider`;
    if (pins.some((candidate) => candidate.id === exact && isProviderPin(candidate))) return exact;
  }

  if (pin.id === 'model' || pin.type === 'model' || pin.type === 'model_text') {
    if (pins.some((candidate) => candidate.id === 'provider' && isProviderPin(candidate))) return 'provider';
  }

  const scope = modelCatalogScopeForPin(pin, pins, nodeType);
  const sameScope = pins.find((candidate) => providerCatalogScopeForPin(candidate, nodeType) === scope);
  return sameScope?.id || null;
}
