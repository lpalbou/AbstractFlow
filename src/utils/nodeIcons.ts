/**
 * Node type → monochrome kit icon (R13.3).
 *
 * The palette and the canvas card draw every node with ONE icon from the
 * ui-kit's icon set (`Icon` from @abstractframework/ui-kit), never the emoji
 * stored on the template (`NodeTemplate.icon` stays in the saved format for
 * older clients; it is simply not rendered any more).
 *
 * Every palette node type has an explicit entry (tests fail on a new type
 * without one). Where the kit has no exact glyph the closest kit icon is used;
 * the gaps are listed in KIT_ICON_GAPS so the kit can grow them.
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
  // Media (gaps: image, video, camera, music)
  generate_image: 'sparkle',
  edit_image: 'edit',
  image_to_image: 'edit',
  upscale_image: 'refresh',
  generate_video: 'playCircle',
  text_to_video: 'playCircle',
  image_to_video: 'playCircle',
  generate_voice: 'speaker',
  generate_music: 'speaker',
  transcribe_audio: 'mic',
  listen_voice: 'mic',
  camera_open: 'play',
  camera_capture_photo: 'download',
  camera_capture_video: 'playCircle',
  camera_analyze_media: 'info',
  camera_close: 'stop',
  // Entity mind
  memory_recall: 'history',
  memory_commit: 'archive',
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
  // Memory (gap: database)
  memory_note: 'archive',
  memory_query: 'history',
  memory_tag: 'paperclip',
  memory_compact: 'archive',
  memory_rehydrate: 'unarchive',
  memory_kg_query: 'board',
  memory_kg_resolve: 'user',
  memact_compose: 'compose',
  memory_kg_assert: 'check',
  // Control flow (gaps: branch, loop)
  loop: 'refresh',
  for: 'refresh',
  while: 'refresh',
  if: 'chevronRight',
  switch: 'list',
  sequence: 'list',
  parallel: 'board',
  compare: 'contrast',
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
  // Variables (gap: variable)
  var_decl: 'settings',
  bool_var: 'settings',
  get_var: 'download',
  get_context: 'download',
  set_var: 'edit',
  set_var_property: 'edit',
  set_vars: 'edit',
  // Math (gaps: minus, divide, function)
  add: 'plus',
  subtract: 'activity',
  multiply: 'x',
  divide: 'activity',
  modulo: 'activity',
  power: 'activity',
  abs: 'activity',
  round: 'activity',
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
  'literal_json|Image Artifact': 'paperclip',
  'literal_json|Voice Artifact': 'speaker',
  'literal_json|Music Artifact': 'speaker',
  'literal_json|Video Artifact': 'playCircle',
};

/** Fallback per semantic category (a node type the map does not know yet). */
export const CATEGORY_ICON: Readonly<Record<string, IconName>> = {
  events: 'clock',
  core: 'sparkle',
  media: 'speaker',
  entity: 'user',
  files: 'folder',
  memory: 'archive',
  control: 'chevronRight',
  literals: 'edit',
  artifacts: 'paperclip',
  schema: 'board',
  variables: 'settings',
  math: 'activity',
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

/** Glyphs the kit lacks; the closest kit icon stands in (listed in COORD for the kit owner). */
export const KIT_ICON_GAPS: readonly string[] = [
  'image', 'video', 'camera', 'music', 'database', 'branch', 'loop', 'variable', 'minus', 'divide',
  'function', 'zoom-out', 'fit-view', 'lock',
];

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
