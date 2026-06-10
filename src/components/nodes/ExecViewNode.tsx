/**
 * Compact node rendering for the execution view (condensed canvas mode).
 *
 * Each compact node is essentially the full-view node header in miniature:
 * the same headerColor, uppercase title and sheen, plus a family icon and a
 * family-specific silhouette (pill events, sharp control bars, speech-bubble
 * interactions, ...). Named exec branches (Sequence "Then 0/1", If
 * "true/false") render as rows in the dark node body, like full-view pins.
 *
 * Nodes keep their ids, positions and exec handle ids, so edges stay attached
 * and the layout matches the full view when switching back and forth.
 */

import { memo, type CSSProperties } from 'react';
import { Handle, Position, type NodeProps } from 'reactflow';
import clsx from 'clsx';
import { useFlowStore } from '../../hooks/useFlow';
import type { FlowNodeData } from '../../types/flow';
import { PIN_COLORS } from '../../types/flow';
import { execNodeFamily, execPins, EXEC_FAMILY_LABELS, type ExecNodeFamily } from '../../utils/execView';
import { getNodeTemplate } from '../../types/nodes';
import { PinShape } from '../pins/PinShape';

function FamilyIcon({ family }: { family: ExecNodeFamily }) {
  const common = {
    className: 'exec-view-icon-svg',
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
    focusable: false,
  };
  switch (family) {
    case 'event':
      // Lightning bolt: triggers / event boundaries.
      return (
        <svg {...common}>
          <path d="M13 2.5 5 13.5h6l-1 8 8-11h-6z" />
        </svg>
      );
    case 'control':
      // Branching paths: sequence/branch/loop control points.
      return (
        <svg {...common}>
          <path d="M4 12h6" />
          <path d="M10 12c3 0 3-5.5 6-5.5H20" />
          <path d="M10 12c3 0 3 5.5 6 5.5H20" />
          <path d="M17.2 4 20 6.5 17.2 9" />
          <path d="M17.2 15 20 17.5 17.2 20" />
        </svg>
      );
    case 'interaction':
      // Question bubble: waits on the user.
      return (
        <svg {...common}>
          <path d="M21 12a8 8 0 0 1-8 8H4l2.2-2.6A8 8 0 1 1 21 12z" />
          <path d="M10.2 9.6a2.4 2.4 0 1 1 3 2.3c-.8.3-1.2.8-1.2 1.6" />
          <path d="M12 16.4h.01" />
        </svg>
      );
    case 'generative':
      // Sparkle: LLM / agent generation.
      return (
        <svg {...common}>
          <path d="M12 4c.7 4.4 2.9 6.6 7.3 7.3-4.4.7-6.6 2.9-7.3 7.3-.7-4.4-2.9-6.6-7.3-7.3 4.4-.7 6.6-2.9 7.3-7.3z" />
        </svg>
      );
    case 'media':
      // Picture frame: generated media artifacts.
      return (
        <svg {...common}>
          <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
          <circle cx="9" cy="9.5" r="1.6" />
          <path d="M20.5 15.5 15.5 11l-7 8.5" />
        </svg>
      );
    case 'io':
      // Wrench: tools / file effects.
      return (
        <svg {...common}>
          <path d="M14.7 6.3a4.6 4.6 0 0 0-6 6L3 18l3 3 5.7-5.7a4.6 4.6 0 0 0 6-6L14 13l-3-3z" />
        </svg>
      );
    case 'memory':
      // Database cylinder: memory operations.
      return (
        <svg {...common}>
          <ellipse cx="12" cy="5.5" rx="7.5" ry="2.8" />
          <path d="M4.5 5.5v13c0 1.5 3.4 2.8 7.5 2.8s7.5-1.3 7.5-2.8v-13" />
          <path d="M4.5 12c0 1.5 3.4 2.8 7.5 2.8s7.5-1.3 7.5-2.8" />
        </svg>
      );
    case 'subflow':
      // Nested boxes: workflow inside a workflow.
      return (
        <svg {...common}>
          <rect x="3.5" y="3.5" width="17" height="17" rx="2.5" />
          <rect x="8.5" y="8.5" width="7" height="7" rx="1.5" />
        </svg>
      );
    default:
      // Gear: logic / state.
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="3" />
          <path d="M12 2.8v3M12 18.2v3M2.8 12h3M18.2 12h3M5.5 5.5l2.1 2.1M16.4 16.4l2.1 2.1M18.5 5.5l-2.1 2.1M7.6 16.4l-2.1 2.1" />
        </svg>
      );
  }
}

export const ExecViewNode = memo(function ExecViewNode({ id, data, selected }: NodeProps<FlowNodeData>) {
  const executingNodeId = useFlowStore((s) => s.executingNodeId);
  const recentNodeIds = useFlowStore((s) => s.recentNodeIds);
  const isExecuting = executingNodeId === id;
  const isRecent = Boolean(recentNodeIds && recentNodeIds[id]);

  const family = execNodeFamily(data.nodeType);
  const { inputs: execInputs, outputs: execOutputs } = execPins(data);
  const multiOut = execOutputs.length > 1;
  const template = getNodeTemplate(data.nodeType);
  const typeLabel = template?.label || data.nodeType;
  // Show the node type as a subtitle only when the user renamed the node;
  // otherwise the family name gives the fastest orientation.
  const subtitle = data.label && data.label !== typeLabel ? typeLabel : EXEC_FAMILY_LABELS[family];
  // Reuse the full-view header color so a node is instantly recognizable when
  // switching modes; the family color stays as a fallback for unknown types.
  const headerColor = data.headerColor || template?.headerColor;

  return (
    <div
      className={clsx(
        'exec-view-node',
        `exec-view-family-${family}`,
        multiOut && 'multi-out',
        execInputs.length > 0 && 'has-exec-in',
        execOutputs.length > 0 && 'has-exec-out',
        selected && 'selected',
        isExecuting && 'executing',
        isRecent && !isExecuting && 'recent'
      )}
      style={headerColor ? ({ '--exec-header-color': headerColor } as CSSProperties) : undefined}
    >
      {execInputs.map((pin) => (
        <Handle
          key={pin.id}
          type="target"
          position={Position.Left}
          id={pin.id}
          className="exec-view-handle exec-view-handle-in"
        />
      ))}

      <div className="exec-view-header">
        <span className="exec-view-icon" aria-hidden="true">
          <FamilyIcon family={family} />
        </span>
        <span className="exec-view-text">
          <span className="exec-view-label">{data.label || typeLabel}</span>
          <span className="exec-view-family-label">{subtitle}</span>
        </span>
        {!multiOut &&
          execOutputs.map((pin) => (
            <Handle
              key={pin.id}
              type="source"
              position={Position.Right}
              id={pin.id}
              className="exec-view-handle exec-view-handle-out"
            />
          ))}
      </div>

      {multiOut ? (
        <div className="exec-view-branches">
          {execOutputs.map((pin) => (
            <div key={pin.id} className="exec-view-branch">
              <span className="exec-view-branch-label">{pin.label || pin.id}</span>
              <span className="exec-view-branch-shape" style={{ color: PIN_COLORS.execution }}>
                <PinShape type="execution" size={10} filled />
              </span>
              <Handle
                type="source"
                position={Position.Right}
                id={pin.id}
                className="exec-view-handle exec-view-handle-branch"
              />
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
});

export default ExecViewNode;
