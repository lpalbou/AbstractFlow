import type { LibraryRow } from '../utils/flowLibraryRows';
import { isExecutableFlow } from '../utils/flowFamilies';

/**
 * Disclosure list of the Flow Library (backlog 0144). Deliberately ONE
 * component with a props-only contract: if the uic seat rules the
 * DisclosureList kit-shaped (commons c1033/c1051), this file is the surgical
 * swap point — semantics stay in flowLibraryRows.ts either way.
 */

export interface FlowLibraryListProps {
  rows: LibraryRow[];
  selectedFlowId: string | null;
  /** Instance-level selection: a shared helper renders N rows for ONE flow;
   * only the clicked instance rings (the others get a quiet same-flow mark). */
  selectedRowKey: string | null;
  currentFlowId: string | null;
  readonlyFlowIds: ReadonlySet<string>;
  bundledRunTargetIds: ReadonlySet<string>;
  selfReferencingIds: ReadonlySet<string>;
  cyclePromotedIds: ReadonlySet<string>;
  /** Names carried by MORE than one flow: rows disambiguate with the short id
   * (operator confusion case: three saved copies all named dp-research). */
  duplicateNames?: ReadonlySet<string>;
  /** In the runnable-only view the runnable badge is redundant noise. */
  hideRunnableBadge?: boolean;
  onSelect: (flowId: string, rowKey: string) => void;
  onLoad: (flowId: string) => void;
  onToggleExpand: (rowKey: string) => void;
}

function formatDateTime(value: unknown): string {
  if (typeof value !== 'string' || !value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  try {
    // Short form for the list: seconds are noise at library scale.
    return d.toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
  } catch {
    return d.toISOString();
  }
}

export function FlowLibraryList({
  rows,
  selectedFlowId,
  selectedRowKey,
  currentFlowId,
  readonlyFlowIds,
  bundledRunTargetIds,
  selfReferencingIds,
  cyclePromotedIds,
  duplicateNames,
  hideRunnableBadge,
  onSelect,
  onLoad,
  onToggleExpand,
}: FlowLibraryListProps) {
  return (
    <>
      {rows.map((row) => {
        if (row.kind === 'missing') {
          return (
            <div
              key={row.key}
              className="flow-library-item missing"
              style={{ ['--flow-row-depth' as string]: row.depth }}
              title="This subflow reference points at a workflow that does not exist — running or publishing the parent will fail. Fix or remove the reference."
            >
              <div className="flow-library-item-top">
                <div className="flow-library-item-name">
                  <span className="flow-library-badge missing">missing</span> {row.missingId}
                </div>
              </div>
              <div className="flow-library-item-sub">
                <span className="flow-library-item-desc">Referenced subflow not found in the library.</span>
              </div>
            </div>
          );
        }

        const flow = row.flow;
        if (!flow) return null;

        if (row.kind === 'cycle') {
          return (
            <div
              key={row.key}
              className="flow-library-item cycle-leaf"
              style={{ ['--flow-row-depth' as string]: row.depth }}
              title="This reference loops back to an ancestor in the expanded path (recursion). It is not expandable here."
            >
              <div className="flow-library-item-top">
                <div className="flow-library-item-name">↻ cycle back to {row.cycleBackTo}</div>
              </div>
            </div>
          );
        }

        const isSelected = selectedRowKey ? row.key === selectedRowKey : flow.id === selectedFlowId;
        const isSameFlow = !isSelected && flow.id === selectedFlowId;
        const isCurrent = Boolean(currentFlowId && flow.id === currentFlowId);
        const isReadonly = readonlyFlowIds.has(flow.id);
        const isBundleTarget = bundledRunTargetIds.has(flow.id);
        const executable = isExecutableFlow(flow);
        const metaUpdated = formatDateTime(flow.updated_at) || formatDateTime(flow.created_at);
        const description = flow.description?.trim() || '';

        return (
          <div
            key={row.key}
            role="button"
            tabIndex={-1}
            data-flow-id={flow.id}
            data-row-key={row.key}
            className={`flow-library-item ${row.kind === 'child' ? 'child' : ''} ${isSelected ? 'selected' : ''} ${isSameFlow ? 'same-flow' : ''}`}
            style={{ ['--flow-row-depth' as string]: row.depth }}
            onClick={() => onSelect(flow.id, row.key)}
            onDoubleClick={() => onLoad(flow.id)}
            title="Double click to load"
          >
            <div className="flow-library-item-top">
              {row.expandable ? (
                <button
                  type="button"
                  className={`flow-library-disclosure ${row.expanded ? 'open' : ''}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    onToggleExpand(row.key);
                  }}
                  aria-expanded={row.expanded}
                  aria-label={row.expanded ? 'Collapse subflows' : 'Expand subflows'}
                  title={
                    row.expanded
                      ? 'Collapse subflows'
                      : (row.familySize ?? 0) > 0
                        ? `Show ${row.familySize} subflow${row.familySize === 1 ? '' : 's'}`
                        : `Show references (${row.missingCount ?? 0} missing)`
                  }
                >
                  ▸
                </button>
              ) : (
                <span className="flow-library-disclosure-spacer" aria-hidden="true" />
              )}
              <div className="flow-library-item-name">
                {flow.name || flow.id}
                {duplicateNames?.has(flow.name || '') && flow.id !== flow.name ? (
                  <span
                    className="flow-library-item-id-hint"
                    title={`Several flows share this name — this one is ${flow.id}`}
                  >
                    {flow.id.length <= 12 ? flow.id : flow.id.slice(0, 8)}
                  </span>
                ) : null}
              </div>
              <div className="flow-library-item-badges">
                {isCurrent ? (
                  <span className="flow-library-badge current" title="Currently open on the canvas">
                    current
                  </span>
                ) : null}
                {executable && !hideRunnableBadge ? (
                  <span
                    className="flow-library-badge runnable"
                    title="Declares a framework-executable interface (runnable as a specialized workflow by hosts)"
                  >
                    runnable
                  </span>
                ) : null}
                {typeof row.familySize === 'number' && row.familySize > 0 ? (
                  <button
                    type="button"
                    className="flow-library-badge family clickable"
                    onClick={(event) => {
                      if (!row.expandable) return;
                      event.stopPropagation();
                      onToggleExpand(row.key);
                    }}
                    title={
                      row.expandable
                        ? `Uses ${row.familySize} subflow${row.familySize === 1 ? '' : 's'} — click to ${row.expanded ? 'collapse' : 'unfold'}`
                        : `Uses ${row.familySize} subflow${row.familySize === 1 ? '' : 's'} (clear the search to browse the family)`
                    }
                  >
                    {row.familySize} subflow{row.familySize === 1 ? '' : 's'}
                  </button>
                ) : null}
                {typeof row.missingCount === 'number' && row.missingCount > 0 ? (
                  <span
                    className="flow-library-badge missing"
                    title={`${row.missingCount} subflow reference${row.missingCount === 1 ? '' : 's'} point at workflows that do not exist — running or publishing will fail`}
                  >
                    {row.missingCount} missing
                  </span>
                ) : null}
                {typeof row.sharedCount === 'number' && row.sharedCount > 1 ? (
                  <span
                    className="flow-library-badge shared"
                    title={`Shared helper: used by ${row.sharedCount} workflows (this row is one view of a single flow)`}
                  >
                    shared ×{row.sharedCount}
                  </span>
                ) : null}
                {typeof row.multiplicity === 'number' && row.multiplicity > 1 ? (
                  <span
                    className="flow-library-badge"
                    title={`Referenced ${row.multiplicity} times by this parent`}
                  >
                    ×{row.multiplicity}
                  </span>
                ) : null}
                {selfReferencingIds.has(flow.id) ? (
                  <span className="flow-library-badge recursive" title="References itself (recursion; needs a base case)">
                    recursive
                  </span>
                ) : null}
                {cyclePromotedIds.has(flow.id) ? (
                  <span
                    className="flow-library-badge cycle"
                    title="Part of a reference cycle with no external parent — promoted to the top level so it stays reachable"
                  >
                    cycle
                  </span>
                ) : null}
                {isBundleTarget ? (
                  <span className="flow-library-badge bundled" title="Ships as a published bundle target">
                    bundle
                  </span>
                ) : isReadonly ? (
                  <span className="flow-library-badge bundled" title="Bundled example (read-only)">
                    bundled
                  </span>
                ) : null}
              </div>
            </div>
            <div className="flow-library-item-sub">
              <span className={`flow-library-item-desc ${description ? '' : 'empty'}`}>
                {description || 'No description'}
              </span>
              {metaUpdated ? <span className="flow-library-item-updated">{metaUpdated}</span> : null}
            </div>
            {row.contextParents && row.contextParents.length > 0 ? (
              <div className="flow-library-item-context">
                in {row.contextParents.slice(0, 3).join(', ')}
                {row.contextParents.length > 3 ? ` +${row.contextParents.length - 3}` : ''}
              </div>
            ) : null}
          </div>
        );
      })}
    </>
  );
}
