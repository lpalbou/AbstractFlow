#!/usr/bin/env node

import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { pathToFileURL } from 'url';
import { build } from 'esbuild';

const root = process.cwd();
const tmpDir = join(root, '.tmp');
const bundlePath = join(tmpDir, 'workflow-node-catalog-nodes.mjs');

function json(value) {
  return JSON.stringify(value, null, 2);
}

function pinText(pin) {
  const label = pin.label && pin.label !== pin.id ? ` (${pin.label})` : '';
  const description = pin.description ? `: ${pin.description}` : '';
  return `\`${pin.id}\` ${pin.type}${label}${description}`;
}

function defaultConfig(data) {
  const omitted = new Set(['nodeType', 'label', 'icon', 'headerColor', 'inputs', 'outputs', 'category', 'code']);
  const entries = Object.entries(data)
    .filter(([key, value]) => !omitted.has(key) && value !== undefined)
    .filter(([, value]) => {
      if (value === null) return true;
      if (typeof value !== 'object') return true;
      if (Array.isArray(value)) return value.length > 0;
      return Object.keys(value).length > 0;
    });
  return entries.length > 0 ? json(Object.fromEntries(entries)) : 'none';
}

function dynamicPolicy(type) {
  const parts = [];
  if (['on_flow_end', 'concat', 'string_template', 'make_object'].includes(type)) parts.push('dynamic inputs');
  if (['on_flow_start', 'break_object'].includes(type)) {
    parts.push(type === 'break_object'
      ? 'dynamic outputs via set_break_paths or add_output_pin; both update selectedPaths'
      : 'dynamic outputs');
  }
  return parts.length > 0 ? parts.join(', ') : 'template pins only';
}

function authorableConfig(template, data, duplicate) {
  const out = [];
  if (duplicate) out.push(`select with \`templateLabel: "${template.label}"\``);
  if ((template.inputs || []).length > 0) out.push('input defaults with `set_pin_default`');
  if (['literal_string', 'literal_number', 'literal_boolean', 'literal_json', 'literal_array', 'json_schema', 'edit_json_schema'].includes(template.type)) {
    out.push('literal value with `literalValue` or `set_literal`');
  }
  if (template.type === 'tools_allowlist') out.push('tool names with `set_literal`');
  if (template.type === 'string_template') out.push('template with `set_literal` or `set_pin_default(template)`');
  if (template.type === 'concat') out.push('separator with `set_concat_separator`');
  if (template.type === 'code') out.push('body/function with `set_code_body`; permissions must remain `sandbox`');
  if (template.type === 'break_object') out.push('selected paths with `set_break_paths`');
  if (template.type === 'switch') out.push('cases with `set_switch_cases`');
  if (template.type === 'sequence' || template.type === 'parallel') out.push('branch count with `set_branch_count`');
  if (template.type === 'tool_parameters') out.push('tool and argument pins with `set_tool_parameters`');
  if (template.type === 'tool_calls') out.push('must include `pinDefaults.allowed_tools` in `add_node`');
  if (['on_event', 'on_agent_message', 'on_schedule'].includes(template.type)) out.push('event settings with `set_event_config`');
  if (template.type === 'subflow') out.push('subflow id is UI-owned; do not create an unconfigured subflow as a finished workflow');
  if (data.providerModelsConfig) out.push('provider models config is UI-owned; use provider/capability pins when possible');
  if (data.modelCatalogConfig) out.push('model catalog config is UI-owned');
  return out.length > 0 ? out.join('; ') : 'no node-specific command config beyond pins/defaults';
}

async function loadNodeModule() {
  mkdirSync(tmpDir, { recursive: true });
  await build({
    entryPoints: [join(root, 'src/types/nodes.ts')],
    outfile: bundlePath,
    bundle: true,
    platform: 'node',
    format: 'esm',
    logLevel: 'silent',
  });
  return import(`${pathToFileURL(bundlePath).href}?v=${Date.now()}`);
}

export async function generateWorkflowNodeCatalog() {
  const mod = await loadNodeModule();
  const templates = mod.getAllNodeTemplates();
  const visible = templates
    .filter((template) => !template.hiddenInPalette && !template.deprecated)
    .sort((a, b) => `${a.category}:${a.type}:${a.label}`.localeCompare(`${b.category}:${b.type}:${b.label}`));
  const countsByType = visible.reduce((acc, template) => acc.set(template.type, (acc.get(template.type) || 0) + 1), new Map());
  const blocked = templates
    .filter((template) => template.hiddenInPalette || template.deprecated)
    .sort((a, b) => `${a.type}:${a.label}`.localeCompare(`${b.type}:${b.label}`));

  const parts = [
    '# AbstractFlow Workflow Node Catalog',
    '',
    'This catalog is generated from `src/types/nodes.ts` by `npm run docs:llms`.',
    'It is the stable AI-readable companion to `docs/workflow-authoring-skill.md`.',
    '',
    'For authoring commands, `nodeType` must match the value shown for the node. If several visible palette entries share a `nodeType`, include the exact `templateLabel` shown in the create command.',
    '',
    '## Visible Authoring Templates',
    '',
  ];

  for (const template of visible) {
    const data = mod.createNodeData(template);
    const duplicate = (countsByType.get(template.type) || 0) > 1;
    const create = template.type === 'tool_calls'
      ? '{"action":"add_node","id":"<unique_id>","nodeType":"tool_calls","pinDefaults":{"allowed_tools":["<exact_tool_name>"]}}'
      : duplicate
        ? `{"action":"add_node","id":"<unique_id>","nodeType":"${template.type}","templateLabel":"${template.label}"}`
        : `{"action":"add_node","id":"<unique_id>","nodeType":"${template.type}"}`;
    parts.push(`### ${template.category || 'uncategorized'} / ${template.label}`);
    parts.push('');
    parts.push(`- Node type: \`${template.type}\``);
    parts.push(`- Create command: \`${create}\``);
    parts.push(`- Utility: ${template.description || 'No description.'}`);
    parts.push(`- Gateway capability: ${template.gatewayCapability || 'none'}`);
    parts.push(`- Dynamic pin policy: ${dynamicPolicy(template.type)}`);
    parts.push(`- Authorable config: ${authorableConfig(template, data, duplicate)}`);
    parts.push(`- Inputs: ${template.inputs.length > 0 ? template.inputs.map(pinText).join('; ') : 'none'}`);
    parts.push(`- Outputs: ${template.outputs.length > 0 ? template.outputs.map(pinText).join('; ') : 'none'}`);
    parts.push(`- Default config: ${defaultConfig(data)}`);
    parts.push('');
  }

  parts.push('## Hidden Or Deprecated Templates');
  parts.push('');
  if (blocked.length === 0) {
    parts.push('None.');
  } else {
    for (const template of blocked) {
      const flags = [template.hiddenInPalette ? 'hidden' : '', template.deprecated ? 'deprecated' : ''].filter(Boolean).join(', ');
      parts.push(`- \`${template.type}\` / ${template.label}: rejected by ` + '`add_node`' + ` (${flags}).`);
    }
  }
  parts.push('');

  writeFileSync(join(root, 'docs/workflow-node-catalog.md'), `${parts.join('\n').trimEnd()}\n`, 'utf8');
  rmSync(tmpDir, { recursive: true, force: true });
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  await generateWorkflowNodeCatalog();
}
