// QA 2026-10-28 (e): Join takes a newline delimiter, by name or typed as \n.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { JOIN_CUSTOM, JOIN_DELIMITER_CHOICES, escapeDelimiter, joinDelimiterChoice, joinDelimiterText } from './joinDelimiter';
import { JoinDelimiterControl } from '../components/nodes/JoinDelimiterControl';
import { nodeHelp } from './nodeHelp';
import { createNodeData, getNodeTemplate } from '../types/nodes';

describe('Join delimiter', () => {
  it('offers New line and Blank line, stored as the escapes the runtime reads', () => {
    expect(JOIN_DELIMITER_CHOICES.find((c) => c.label === 'New line')?.value).toBe('\\n');
    expect(JOIN_DELIMITER_CHOICES.find((c) => c.label === 'Blank line')?.value).toBe('\\n\\n');
    expect(joinDelimiterText('\\n')).toBe('\n');
    expect(joinDelimiterText('\\n\\n')).toBe('\n\n');
    expect(joinDelimiterText('\\t')).toBe('\t');
    expect(joinDelimiterText(undefined)).toBe(',');
  });

  it('a saved delimiter maps to its choice; a real newline counts as New line; anything else is custom', () => {
    expect(joinDelimiterChoice(undefined)).toBe(',');
    expect(joinDelimiterChoice('\\n')).toBe('\\n');
    expect(joinDelimiterChoice('\n')).toBe('\\n');
    expect(joinDelimiterChoice(' ; ')).toBe(JOIN_CUSTOM);
    expect(escapeDelimiter('a\nb\tc')).toBe('a\\nb\\tc');
  });

  it('the node control shows the choice by name, and a text field for a custom delimiter', () => {
    const newline = renderToStaticMarkup(createElement(JoinDelimiterControl, { value: '\\n', onChange: () => undefined }));
    expect(newline).toContain('New line');
    expect(newline).not.toContain('af-pin-input');
    const custom = renderToStaticMarkup(createElement(JoinDelimiterControl, { value: ' ; ', onChange: () => undefined }));
    expect(custom).toContain('af-pin-input');
    expect(custom).toContain('value=" ; "');
  });

  it('the help says how to get a new line', () => {
    const help = nodeHelp(createNodeData(getNodeTemplate('join')!));
    expect(help.details.join(' ')).toContain('Choose New line');
    expect(help.details.join(' ')).toContain('\\n (new line)');
  });
});
