import { memo, useEffect, useState, type MouseEvent } from 'react';
import { Handle, Position, useUpdateNodeInternals, type NodeProps } from 'reactflow';
import { useFlowStore } from '../../hooks/useFlow';
import { getNodeTemplate } from '../../types/nodes';
import { PIN_COLORS, type FlowNodeData, type Pin } from '../../types/flow';
import { categoryColorVar, nodeColorSection } from '../../utils/nodeCategoryColors';
import { foldedShape, operatorInputSources, operatorOutputRows, operatorSymbol, operatorTitle } from '../../utils/operatorNodes';
import { Icon } from '@abstractframework/ui-kit';
import { PinShape } from '../pins/PinShape';
import { HiddenConnectionsBadge } from './HiddenConnectionsBadge';
import { collectDeclaredVarNames } from '../../utils/preflight';
import { parseTemplate, slotKind, templateInputPins } from '../../utils/textTemplate';

const PIN_GAP = 18;
const MIN_SIZE = 56;

/** A String Template's text with its chips, for the hover card of the folded node (operator 2026-10-14). */
function TemplateText({ data }: { data: FlowNodeData }) {
  const nodes = useFlowStore((st) => st.nodes);
  const text = typeof data.pinDefaults?.template === 'string' ? data.pinDefaults.template : '';
  const inputs = new Set(templateInputPins(data.inputs || []).map((p) => p.id));
  const variables = collectDeclaredVarNames(nodes);
  const segments = parseTemplate(text);
  return (
    <div className="operator-card-template">
      {segments.length === 0 ? (
        <span className="collapsed-template-empty">empty text</span>
      ) : (
        segments.map((seg, i) =>
          seg.kind === 'text' ? (
            <span key={i}>{seg.text}</span>
          ) : (
            <span key={i} className={`tpl-chip tpl-chip--${slotKind(seg.name, inputs, variables)}`}>
              {seg.name}
            </span>
          )
        )
      )}
    </div>
  );
}

/** The hover card: what the operator is, what feeds each input, its outputs. */
function OperatorCard({ id, data }: { id: string; data: FlowNodeData }) {
  const nodes = useFlowStore((st) => st.nodes);
  const edges = useFlowStore((st) => st.edges);
  // A String Template's text is shown as its own block below, never as a `{{…}}` literal row.
  const sources = operatorInputSources(id, data, nodes, edges).filter((s) => !(data.nodeType === 'string_template' && s.pin === 'template'));
  const title = operatorTitle(data.nodeType) || data.label;
  // A node renamed on the canvas ("Build prompt") keeps its name on top.
  const named = data.label && data.label !== getNodeTemplate(data.nodeType)?.label ? data.label : '';
  return (
    <div className="operator-card" role="tooltip">
      <div className="operator-card-title">{named || title}</div>
      {named ? <div className="operator-card-subtitle">{title}</div> : null}
      {data.nodeType === 'string_template' ? <TemplateText data={data} /> : null}
      {sources.length ? (
        <dl className="operator-card-inputs">
          {sources.map((source) => (
            <div key={source.pin} className={`operator-card-row operator-card-row--${source.kind}`}>
              <dt>{source.pin}</dt>
              <dd>
                {source.kind === 'variable' || source.kind === 'expression' ? (
                  <span className="operator-card-kind">{source.kind === 'variable' ? 'variable' : 'ƒx'}</span>
                ) : null}
                {source.text}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
      {/* An operator's generic result: just its type. Named outputs (Break Object's
          fields): name, path when it differs, type and what its schema adds. */}
      {operatorOutputRows(data).map((row) => (
        <div key={row.path || row.name || row.type} className="operator-card-output">
          → {row.name ? <span className="operator-card-output-name">{row.name}</span> : null}
          {row.path ? <span className="operator-card-output-path">{row.path}</span> : null}
          {row.name ? ' ' : ''}
          <span style={{ color: PIN_COLORS[row.type as keyof typeof PIN_COLORS] }}>{row.type}</span>
          {row.detail ? <span className="operator-card-output-detail"> {row.detail}</span> : null}
        </div>
      ))}
      <div className="operator-card-hint">Double-click (or tap) to unfold</div>
    </div>
  );
}

/**
 * An operator node folded (utils/operatorNodes.ts): a circle (a capsule when it
 * has many pins) with the operator sign, its inputs on the left and its outputs
 * on the right, under the same handle ids as the full card, so every wire stays
 * attached. It keeps the card's run status and hidden-connections badge, and a
 * click on a connected pin disconnects it, as on the card. Hovering it shows
 * what it is and what feeds each input.
 */
export const CollapsedOperatorNode = memo(function CollapsedOperatorNode({ id, data, selected }: NodeProps<FlowNodeData>) {
  const updateNodeInternals = useUpdateNodeInternals();
  const edges = useFlowStore((s) => s.edges);
  const disconnectPin = useFlowStore((s) => s.disconnectPin);
  const isExecuting = useFlowStore((s) => s.executingNodeId === id);
  const isWaiting = useFlowStore((s) => s.waitingNodeId === id);
  const isFailed = useFlowStore((s) => s.failedNodeId === id);
  const isRecent = useFlowStore((s) => Boolean(s.recentNodeIds && (s.recentNodeIds as Record<string, true>)[id]));
  const [hovered, setHovered] = useState(false);
  const inputs = data.inputs.filter((pin) => pin.type !== 'execution');
  const outputs = data.outputs.filter((pin) => pin.type !== 'execution');
  const height = Math.max(MIN_SIZE, Math.max(inputs.length, outputs.length) * PIN_GAP + 20);
  const connected = (pinId: string, isInput: boolean) =>
    edges.some((e) => (isInput ? e.target === id && e.targetHandle === pinId : e.source === id && e.sourceHandle === pinId));

  // The handles moved or were renamed (same count, other ids): React Flow
  // re-measures them so the wires follow.
  const pinKey = `${inputs.map((p) => p.id).join('|')}__${outputs.map((p) => p.id).join('|')}`;
  useEffect(() => {
    updateNodeInternals(id);
  }, [id, pinKey, updateNodeInternals]);

  const pinClick = (e: MouseEvent, pinId: string, isInput: boolean) => {
    if (e.type !== 'click' || !connected(pinId, isInput)) return;
    e.preventDefault();
    e.stopPropagation();
    disconnectPin(id, pinId, isInput);
  };
  const pinTop = (index: number, count: number) => height / 2 + (index - (count - 1) / 2) * PIN_GAP;
  const renderPin = (pin: Pin, index: number, count: number, isInput: boolean) => (
    <span
      key={`${isInput ? 'in' : 'out'}-${pin.id}`}
      className={`collapsed-operator-pin collapsed-operator-pin--${isInput ? 'in' : 'out'}`}
      style={{ top: pinTop(index, count), color: PIN_COLORS[pin.type] }}
    >
      <PinShape type={pin.type} size={10} filled={connected(pin.id, isInput)} />
      <Handle
        type={isInput ? 'target' : 'source'}
        position={isInput ? Position.Left : Position.Right}
        id={pin.id}
        className={`pin ${pin.type}`}
        onClickCapture={(e) => pinClick(e, pin.id, isInput)}
      />
    </span>
  );

  // The pin whose value the face shows (Compare: op; a getter: name) is wired?
  const faceWired = connected(data.nodeType === 'get_var' ? 'name' : 'op', true);
  const shape = foldedShape(data.nodeType);
  return (
    <div
      className={[
        'collapsed-operator',
        `collapsed-operator--${shape}`,
        selected && 'selected',
        isExecuting && !isWaiting && 'executing',
        isWaiting && 'waiting',
        isFailed && 'failed',
        isRecent && !isExecuting && !isFailed && 'recent',
      ]
        .filter(Boolean)
        .join(' ')}
      style={{ height, minWidth: MIN_SIZE, width: shape === 'circle' ? MIN_SIZE : undefined, ['--node-hue' as string]: categoryColorVar(nodeColorSection(data.nodeType, data.label)) }}
      data-node-type={data.nodeType}
      data-run-status={isFailed ? 'failed' : isWaiting ? 'waiting' : isExecuting ? 'running' : isRecent ? 'done' : undefined}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {data.nodeType === 'string_template' ? (
        // Folded, a String Template is its icon (a page and a pen); the hover card shows the text.
        <span className="collapsed-template-icon" aria-label="Text with variables">
          <Icon name="compose" size={20} />
        </span>
      ) : data.nodeType === 'get_vars' ? (
        // Get Variables folds to its list of names, each beside its output pin.
        <span className="collapsed-getvars-names">
          {outputs.map((pin) => (
            <span key={pin.id} className="collapsed-getvars-name" style={{ height: PIN_GAP }}>
              {pin.label || pin.id}
            </span>
          ))}
        </span>
      ) : (
        <span className="collapsed-operator-sign">{operatorSymbol(data, faceWired)}</span>
      )}
      <span className="collapsed-operator-badge">
        <HiddenConnectionsBadge nodeId={id} />
      </span>
      {hovered ? <OperatorCard id={id} data={data} /> : null}
      {inputs.map((pin, index) => renderPin(pin, index, inputs.length, true))}
      {outputs.map((pin, index) => renderPin(pin, index, outputs.length, false))}
    </div>
  );
});
