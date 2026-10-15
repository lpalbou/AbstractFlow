import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { parseTemplate, serializeTemplate, slotKind, templateInputNameProblem, type SlotKind, type TemplateSegment } from '../utils/textTemplate';

/**
 * A text with variable chips (utils/textTemplate.ts), edited in place, on the node card and in the
 * Properties panel (operator 2026-10-12: "i should be able to write the text directly from an input
 * field and put the variable there... detect @ to show the various variables"). Typing `@` opens
 * the list of the node's inputs and the run's variables, filtered as you type; Enter, Tab or a
 * click puts the chip in place of `@…`. A name that is neither becomes a new input of the node
 * (a value that comes from a wire). A chip is one unit (one Backspace removes it; Undo works).
 * Stored as `{{name}}`.
 */

/** Typed after a chip so the caret has a text position right after it; never saved. */
const CARET_ANCHOR = '\u200B';
/** `@` then a name being typed, at the caret; the `@` starts the text or follows a non-word character. */
const MENTION = /(?:^|[^\w])@([\w.]*)$/;
const MAX_CHOICES = 8;

type Choice = { kind: 'input' | 'variable' | 'new'; name: string };

function chipTitle(kind: SlotKind, name: string): string {
  if (kind === 'input') return `${name}: an input of this node (the value its wire brings)`;
  if (kind === 'variable') return `${name}: run variable`;
  return `${name}: no input of this node and no step sets this variable`;
}

function chipElement(expr: string, name: string, inputs: ReadonlySet<string>, variables: ReadonlySet<string>): HTMLSpanElement {
  const kind = slotKind(name, inputs, variables);
  const chip = document.createElement('span');
  chip.className = `tpl-chip tpl-chip--${kind}`;
  chip.contentEditable = 'false';
  chip.dataset.expr = expr;
  chip.title = chipTitle(kind, name);
  chip.textContent = name;
  return chip;
}

/** The segments the editor's DOM holds (text, chips, and the line breaks a browser may add). */
function readSegments(root: HTMLElement): TemplateSegment[] {
  const out: TemplateSegment[] = [];
  const walk = (node: Node, isFirstBlock: boolean) => {
    if (node.nodeType === Node.TEXT_NODE) {
      out.push({ kind: 'text', text: (node.textContent || '').split(CARET_ANCHOR).join('') });
      return;
    }
    if (!(node instanceof HTMLElement)) return;
    if (node.dataset.expr !== undefined) {
      out.push({ kind: 'slot', expr: node.dataset.expr, name: node.textContent || '' });
      return;
    }
    if (node.tagName === 'BR') {
      // A browser keeps an empty line (or an emptied editor) open with a trailing <br>: not text.
      if (node.nextSibling === null) return;
      out.push({ kind: 'text', text: '\n' });
      return;
    }
    if ((node.tagName === 'DIV' || node.tagName === 'P') && !isFirstBlock) out.push({ kind: 'text', text: '\n' });
    node.childNodes.forEach((child, i) => walk(child, i === 0));
  };
  root.childNodes.forEach((child, i) => walk(child, i === 0));
  return out;
}

function render(root: HTMLElement, text: string, inputs: ReadonlySet<string>, variables: ReadonlySet<string>) {
  root.replaceChildren(
    ...parseTemplate(text).map((seg) =>
      seg.kind === 'text' ? document.createTextNode(seg.text) : chipElement(seg.expr, seg.name, inputs, variables)
    )
  );
}

/** The choices for what is typed after `@`: inputs, then variables; "new input" when nothing known matches. */
export function mentionChoices(query: string, inputs: string[], variables: string[]): Choice[] {
  const q = query.toLowerCase();
  const rank = (name: string) => (name.toLowerCase().startsWith(q) ? 0 : 1);
  const pick = (names: string[], kind: Choice['kind']) =>
    names
      .filter((n) => n.toLowerCase().includes(q))
      .sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
      .map((name) => ({ kind, name }));
  const known = [...pick(inputs, 'input'), ...pick(variables.filter((v) => !inputs.includes(v)), 'variable')];
  // Offered once nothing known matches what is typed (a prefix of a known name is not a new name).
  const canAdd = query && known.length === 0 && templateInputNameProblem(query, new Set(inputs)) === null;
  return [...known.slice(0, MAX_CHOICES), ...(canAdd ? [{ kind: 'new' as const, name: query }] : [])];
}

type Mention = { node: Text; start: number; end: number; query: string; left: number; top: number };

export interface TemplateTextEditorProps {
  value: string;
  onChange: (next: string) => void;
  /** Inputs of the node (values from a wire). */
  inputs: string[];
  /** Run variables of the flow. */
  variables: string[];
  /** Adds an input to the node; returns false when the name is refused. */
  onAddInput: (name: string) => boolean;
  ariaLabel?: string;
  /** On the node card: compact, and the canvas must not drag or zoom while editing. */
  inline?: boolean;
}

export function TemplateTextEditor({ value, onChange, inputs, variables, onAddInput, ariaLabel, inline }: TemplateTextEditorProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  const emitted = useRef<string | null>(null);
  const [mention, setMention] = useState<Mention | null>(null);
  const [active, setActive] = useState(0);
  const inputSet = new Set(inputs);
  const variableSet = new Set(variables);
  const kindsKey = `${inputs.join(',')}|${variables.join(',')}`;
  const choices = mention ? mentionChoices(mention.query, inputs, variables) : [];

  // Re-render from `value` unless it is what this editor just emitted (keeps the caret while typing).
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || value === emitted.current) return;
    render(el, value, inputSet, variableSet);
    emitted.current = value;
  }, [value]);

  // Chip colours follow the node's inputs and the flow's variables.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.querySelectorAll<HTMLElement>('[data-expr]').forEach((chip) => {
      const kind = slotKind(chip.textContent || '', inputSet, variableSet);
      chip.className = `tpl-chip tpl-chip--${kind}`;
      chip.title = chipTitle(kind, chip.textContent || '');
    });
  }, [kindsKey]);

  const emit = () => {
    const el = ref.current;
    if (!el) return;
    const next = serializeTemplate(readSegments(el));
    emitted.current = next;
    if (next !== value) onChange(next);
  };

  /** Opens, follows or closes the `@` list from what is typed just before the caret. */
  const trackMention = () => {
    const el = ref.current;
    const sel = window.getSelection();
    if (!el || !sel || sel.rangeCount === 0 || !sel.isCollapsed) return setMention(null);
    const range = sel.getRangeAt(0);
    const node = range.startContainer;
    if (node.nodeType !== Node.TEXT_NODE || !el.contains(node)) return setMention(null);
    const before = (node.textContent || '').slice(0, range.startOffset).split(CARET_ANCHOR).join('');
    const match = MENTION.exec(before);
    if (!match) return setMention(null);
    const typed = match[1];
    const raw = (node.textContent || '').slice(0, range.startOffset);
    const start = raw.lastIndexOf('@');
    const rect = range.getBoundingClientRect();
    if (mention?.query !== typed) setActive(0);
    setMention({ node: node as Text, start, end: range.startOffset, query: typed, left: rect.left, top: rect.bottom + 4 });
  };

  const choose = (choice: Choice) => {
    const el = ref.current;
    if (!el || !mention) return;
    if (choice.kind === 'new' && !onAddInput(choice.name)) return;
    const sel = window.getSelection();
    const range = document.createRange();
    range.setStart(mention.node, mention.start);
    range.setEnd(mention.node, Math.min(mention.end, mention.node.length));
    sel?.removeAllRanges();
    sel?.addRange(range);
    // A just-added input is not in `inputs` yet; the colour effect catches up on the next render.
    const chip = chipElement(choice.name, choice.name, choice.kind === 'new' ? new Set([choice.name]) : inputSet, variableSet);
    // Through the editing commands, so Undo takes the chip back out.
    document.execCommand('insertHTML', false, chip.outerHTML + CARET_ANCHOR);
    setMention(null);
    emit();
  };

  const kindLabel = (kind: Choice['kind']) => (kind === 'input' ? 'input' : kind === 'variable' ? 'variable' : 'new input');

  return (
    <div className={inline ? 'template-text template-text--inline nodrag nowheel' : 'template-text'}>
      <div
        ref={ref}
        className="template-text-editor property-input"
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-multiline="true"
        aria-label={ariaLabel || 'Text'}
        aria-autocomplete="list"
        aria-expanded={Boolean(mention)}
        data-placeholder="Type the text; @ inserts a variable"
        spellCheck={false}
        onInput={() => {
          emit();
          trackMention();
        }}
        onKeyUp={(e) => {
          if (!['ArrowUp', 'ArrowDown', 'Enter', 'Tab', 'Escape'].includes(e.key)) trackMention();
        }}
        onMouseDown={(e) => e.stopPropagation()}
        onMouseUp={trackMention}
        onBlur={() => setTimeout(() => setMention(null), 150)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (mention && choices.length > 0) {
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              e.preventDefault();
              setActive((i) => (i + (e.key === 'ArrowDown' ? 1 : choices.length - 1)) % choices.length);
              return;
            }
            if ((e.key === 'Enter' || e.key === 'Tab') && !e.nativeEvent.isComposing) {
              e.preventDefault();
              choose(choices[Math.min(active, choices.length - 1)]);
              return;
            }
          }
          if (e.key === 'Escape' && mention) {
            e.preventDefault();
            setMention(null);
            return;
          }
          if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
            e.preventDefault();
            document.execCommand('insertText', false, '\n');
          }
        }}
        onPaste={(e) => {
          e.preventDefault();
          document.execCommand('insertText', false, e.clipboardData.getData('text/plain'));
        }}
      />
      {mention && choices.length > 0 && typeof document !== 'undefined'
        ? createPortal(
            <div className="template-mention" role="listbox" aria-label="Variables" style={{ left: mention.left, top: mention.top }}>
              {choices.map((choice, i) => (
                <button
                  key={`${choice.kind}-${choice.name}`}
                  type="button"
                  role="option"
                  aria-selected={i === active}
                  className={i === active ? 'template-mention__item is-active' : 'template-mention__item'}
                  onMouseDown={(e) => e.preventDefault()}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => choose(choice)}
                >
                  <span className={`tpl-chip tpl-chip--${choice.kind === 'new' ? 'input' : choice.kind}`}>{choice.name}</span>
                  <span className="template-mention__kind">{kindLabel(choice.kind)}</span>
                </button>
              ))}
            </div>,
            document.body
          )
        : null}
    </div>
  );
}
