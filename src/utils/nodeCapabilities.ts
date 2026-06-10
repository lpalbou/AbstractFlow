import type { NodeType } from '../types/flow';

export type GatewayAuthoringCapability =
  | 'generated_image'
  | 'edited_image'
  | 'upscaled_image'
  | 'generated_video'
  | 'image_to_video'
  | 'generated_voice'
  | 'generated_music'
  | 'model_residency'
  | 'tools'
  | 'kg_memory';

export const NODE_GATEWAY_CAPABILITIES: Partial<Record<NodeType, GatewayAuthoringCapability>> = {
  model_residency: 'model_residency',
  generate_image: 'generated_image',
  edit_image: 'edited_image',
  image_to_image: 'edited_image',
  upscale_image: 'upscaled_image',
  generate_video: 'generated_video',
  text_to_video: 'generated_video',
  image_to_video: 'image_to_video',
  generate_voice: 'generated_voice',
  generate_music: 'generated_music',
  tool_calls: 'tools',
  call_tool: 'tools',
  memory_kg_assert: 'kg_memory',
  memory_kg_query: 'kg_memory',
  memory_kg_resolve: 'kg_memory',
};

export function gatewayCapabilityForNodeType(nodeType: string | undefined | null): GatewayAuthoringCapability | undefined {
  if (!nodeType) return undefined;
  return NODE_GATEWAY_CAPABILITIES[nodeType as NodeType];
}
