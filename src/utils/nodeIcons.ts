/**
 * Node type → monochrome kit icon (R13.3).
 *
 * The palette and the canvas card draw every node with ONE icon from the
 * ui-kit's icon set (`Icon` from @abstractframework/ui-kit), never the emoji
 * stored on the template (`NodeTemplate.icon` stays in the saved format for
 * older clients; it is simply not rendered any more).
 *
 * Every palette node type has an explicit entry (tests fail on a new type
 * without one), and every entry names an icon the kit really has
 * (`ICON_NAMES`, ui-kit 0.8.6: image, video, camera, music, database, branch,
 * loop, variable, minus, divide, function were added for these nodes).
 */
import type { IconName } from '@abstractframework/ui-kit';

/** Explicit icon per node type. */
export const NODE_ICON_BY_TYPE: Readonly<Record<string, IconName>> = {
  // Events & time
  on_flow_start: 'playCircle',
  on_flow_end: 'stop',
  on_user_request: 'chat',
  on_agent_message: 'inbox',
  system_datetime: 'clock',
  on_schedule: 'clock',
  on_event: 'inbox',
  wait_event: 'pause',
  emit_event: 'send',
  wait_until: 'history',
  // Core
  agent: 'agent',
  subflow: 'board',
  llm_call: 'sparkle',
  model_residency: 'server',
  tool_calls: 'terminal',
  call_tool: 'terminal',
  ask_user: 'chat',
  answer_user: 'send',
  code: 'terminal',
  add_message: 'compose',
  // Media
  generate_image: 'image',
  edit_image: 'image',
  image_to_image: 'image',
  upscale_image: 'image',
  generate_video: 'video',
  text_to_video: 'video',
  image_to_video: 'video',
  generate_voice: 'speaker',
  generate_music: 'music',
  transcribe_audio: 'mic',
  listen_voice: 'mic',
  camera_open: 'camera',
  camera_capture_photo: 'camera',
  camera_capture_video: 'video',
  camera_analyze_media: 'camera',
  camera_close: 'camera',
  // Entity mind
  memory_recall: 'history',
  memory_commit: 'database',
  memory_form: 'compose',
  memory_adjust: 'settings',
  memory_appraise: 'thumbsUp',
  diary_write: 'edit',
  diary_read: 'book',
  memory_consolidate: 'refresh',
  memory_probe: 'activity',
  life_query: 'user',
  memory_tend: 'check',
  entity_tools_query: 'cog',
  entity_tools_execute: 'terminal',
  // Files & artifacts
  read_file: 'file',
  write_file: 'compose',
  read_pdf: 'file',
  write_pdf: 'compose',
  write_docx: 'compose',
  write_chart: 'activity',
  list_folder_files: 'folder',
  import_workspace_file: 'download',
  read_artifact: 'paperclip',
  export_artifact: 'download',
  // Memory
  memory_note: 'database',
  memory_query: 'database',
  memory_tag: 'paperclip',
  memory_compact: 'database',
  memory_rehydrate: 'unarchive',
  memory_kg_query: 'database',
  memory_kg_resolve: 'user',
  memact_compose: 'compose',
  memory_kg_assert: 'check',
  // Control flow
  loop: 'loop',
  for: 'loop',
  while: 'loop',
  if: 'branch', // two outcomes (true / false)
  switch: 'branch',
  sequence: 'list',
  parallel: 'board',
  compare: 'activity',
  and: 'check',
  or: 'check',
  not: 'x',
  // Values & schema
  literal_string: 'edit',
  literal_number: 'edit',
  literal_boolean: 'check',
  literal_json: 'file',
  literal_array: 'list',
  json_schema: 'board',
  edit_json_schema: 'board',
  provider_catalog: 'server',
  provider_models: 'server',
  tools_allowlist: 'cog',
  tool_parameters: 'settings',
  // Variables
  var_decl: 'variable',
  bool_var: 'variable',
  get_var: 'variable',
  get_context: 'variable',
  set_var: 'variable',
  set_var_property: 'variable',
  set_vars: 'variable',
  // Math
  add: 'plus',
  subtract: 'minus',
  multiply: 'x',
  divide: 'divide',
  modulo: 'function',
  power: 'function',
  abs: 'function',
  round: 'function',
  random_int: 'refresh',
  random_float: 'refresh',
  // Data & text
  concat: 'plus',
  split: 'list',
  join: 'list',
  format: 'compose',
  string_template: 'compose',
  uppercase: 'edit',
  lowercase: 'edit',
  trim: 'edit',
  is_empty_string: 'info',
  contains: 'info',
  replace: 'refresh',
  substring: 'edit',
  length: 'info',
  coalesce: 'check',
  get: 'download',
  get_element: 'download',
  get_random_element: 'refresh',
  set: 'edit',
  merge: 'plus',
  make_array: 'list',
  make_object: 'file',
  make_context: 'chat',
  make_meta: 'info',
  make_scratchpad: 'compose',
  array_length: 'info',
  has_tools: 'cog',
  array_append: 'plus',
  array_dedup: 'list',
  array_map: 'list',
  array_filter: 'list',
  array_concat: 'plus',
  parse_json: 'file',
  stringify_json: 'file',
  format_tool_results: 'terminal',
  agent_trace_report: 'activity',
  break_object: 'list',
};

/**
 * Templates that share a `type` but read as different nodes (the literal_json
 * family): keyed by the template label. A renamed node falls back to its type.
 */
export const NODE_ICON_BY_TYPE_AND_LABEL: Readonly<Record<string, IconName>> = {
  'literal_json|Memory': 'archive',
  'literal_json|Assertion': 'check',
  'literal_array|Assertions': 'check',
  'literal_json|Artifact': 'paperclip',
  'literal_json|Text Artifact': 'file',
  'literal_json|Image Artifact': 'image',
  'literal_json|Voice Artifact': 'speaker',
  'literal_json|Music Artifact': 'music',
  'literal_json|Video Artifact': 'video',
};

/** Fallback per semantic category (a node type the map does not know yet). */
export const CATEGORY_ICON: Readonly<Record<string, IconName>> = {
  events: 'clock',
  core: 'sparkle',
  media: 'image',
  entity: 'user',
  files: 'folder',
  memory: 'database',
  control: 'branch',
  literals: 'edit',
  artifacts: 'paperclip',
  schema: 'board',
  variables: 'variable',
  math: 'function',
  data: 'list',
};

/** The canvas card's type badge: one short word per semantic category. */
export const CATEGORY_BADGE: Readonly<Record<string, string>> = {
  events: 'Event',
  core: 'Core',
  media: 'Media',
  entity: 'Entity',
  files: 'File',
  memory: 'Memory',
  control: 'Control',
  literals: 'Value',
  artifacts: 'Artifact',
  schema: 'Schema',
  variables: 'Variable',
  math: 'Math',
  data: 'Data',
};

export function nodeTypeBadge(category: string | undefined): string {
  return (category && CATEGORY_BADGE[category]) || 'Node';
}

/** The kit icon for a node (type + label first, then type, then its category, then a neutral file). */
export function nodeIconName(nodeType: string, label?: string, category?: string): IconName {
  if (label) {
    const byLabel = NODE_ICON_BY_TYPE_AND_LABEL[`${nodeType}|${label}`];
    if (byLabel) return byLabel;
  }
  const byType = NODE_ICON_BY_TYPE[nodeType];
  if (byType) return byType;
  if (category && CATEGORY_ICON[category]) return CATEGORY_ICON[category];
  return 'file';
}
