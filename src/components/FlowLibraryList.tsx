import { useMemo } from 'react';
import { AfChip, AfChipButton, DisclosureList, type AfChipTone, type DisclosureRow } from '@abstractframework/ui-kit';
import type { LibraryRow } from '../utils/flowLibraryRows';
import { isExecutableFlow } from '../utils/flowFamilies';

/**
 * Flow Library rows — a CONSUMER of the uic kit DisclosureList (the
 * absorb-then-delete swap agreed at commons c1033/c1106/c1239; the kit
 * component was built to the contract this file's fork paid for: dual-key
 * selection, path-keyed controlled expansion, flat-with-depth rows).
 *
 * Badges are kit AfChip/AfChipButton (operator AA approval c1652). Per the
 * amended chip contract (c1116) the kit owns tones + geometry + the AA text
 * derivation recipe; the name→tone map below is flow's own data — the kit
 * deliberately does not know what "shared" or "current" mean.
 */
const BADGE_TONES: Record<string, AfChipTone> = {
  current: 'success',
  runnable: 'success',
  family: 'info',
  bundled: 'info',
  shared: 'warning',
  recursive: 'warning',
  cycle: 'warning',
  missing: 'error',
  multiplicity: 'neutral',
};

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
   * (operator confusion case: three saved copies all named deep-research). */
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

/** Path keys embed ancestry (`a>b>c`); the parent row key is the path prefix. */
function parentKeyOf(row: LibraryRow): string | undefined {
  const idx = row.key.lastIndexOf('>');
  if (idx <= 0) return undefined;
  return row.key.slice(0, idx);
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
  const kitRows = useMemo<DisclosureRow<LibraryRow>[]>(
    () =>
      rows.map((row) => ({
        key: row.key,
        entityId: row.flow?.id || row.missingId || row.key,
        parentKey: parentKeyOf(row),
        depth: row.depth,
        expandable: row.expandable,
        expanded: row.expanded,
        // Missing/cycle rows are diagnostics, not selectable flows.
        selectable: row.kind === 'top' || row.kind === 'child',
        textValue: row.flow?.name || row.missingId || row.key,
        data: row,
      })),
    [rows]
  );

  const selection = useMemo(() => {
    if (!selectedFlowId) return null;
    // A remembered row key can go STALE (its parent collapsed, or a query
    // flattened the rows): validate it against the visible rows and fall back
    // to the flow's first visible instance so the anchor ring never silently
    // vanishes while the entity stays selected.
    if (selectedRowKey && kitRows.some((r) => r.key === selectedRowKey && r.selectable !== false)) {
      return { entityId: selectedFlowId, rowKey: selectedRowKey };
    }
    const match = kitRows.find((r) => r.entityId === selectedFlowId && r.selectable !== false);
    return match ? { entityId: selectedFlowId, rowKey: match.key } : null;
  }, [kitRows, selectedFlowId, selectedRowKey]);

  const renderRow = (kitRow: DisclosureRow<LibraryRow>) => {
    const row = kitRow.data as LibraryRow;

    if (row.kind === 'missing') {
      return (
        <div
          className="flow-library-row missing"
          data-row-key={row.key}
          title="This subflow reference points at a workflow that does not exist — running or publishing the parent will fail. Fix or remove the reference."
        >
          <div className="flow-library-item-top">
            <div className="flow-library-item-name">
              <AfChip tone={BADGE_TONES.missing} size="sm">
                missing
              </AfChip>{' '}
              {row.missingId}
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
          className="flow-library-row cycle-leaf"
          data-row-key={row.key}
          title="This reference loops back to an ancestor in the expanded path (recursion). It is not expandable here."
        >
          <div className="flow-library-item-top">
            <div className="flow-library-item-name">↻ cycle back to {row.cycleBackTo}</div>
          </div>
        </div>
      );
    }

    const isCurrent = Boolean(currentFlowId && flow.id === currentFlowId);
    const isReadonly = readonlyFlowIds.has(flow.id);
    const isBundleTarget = bundledRunTargetIds.has(flow.id);
    const executable = isExecutableFlow(flow);
    const metaUpdated = formatDateTime(flow.updated_at) || formatDateTime(flow.created_at);
    const description = flow.description?.trim() || '';

    return (
      <div
        className={`flow-library-row ${row.kind === 'child' ? 'child' : ''}`}
        data-flow-id={flow.id}
        data-row-key={row.key}
        title="Double click to load"
      >
        <div className="flow-library-item-top">
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
              <AfChip tone={BADGE_TONES.current} size="sm" title="Currently open on the canvas">
                current
              </AfChip>
            ) : null}
            {executable && !hideRunnableBadge ? (
              <AfChip
                tone={BADGE_TONES.runnable}
                size="sm"
                title="Declares a framework-executable interface (runnable as a specialized workflow by hosts)"
              >
                runnable
              </AfChip>
            ) : null}
            {typeof row.familySize === 'number' && row.familySize > 0 ? (
              // DisclosureList's roving-tabindex contract: inner interactive
              // elements sit at tabIndex=-1 (kit passthrough shipped on our
              // c2186 ask).
              <AfChipButton
                tone={BADGE_TONES.family}
                size="sm"
                className="flow-library-family-chip"
                tabIndex={-1}
                expanded={row.expandable ? row.expanded : undefined}
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
              </AfChipButton>
            ) : null}
            {typeof row.missingCount === 'number' && row.missingCount > 0 ? (
              <AfChip
                tone={BADGE_TONES.missing}
                size="sm"
                title={`${row.missingCount} subflow reference${row.missingCount === 1 ? '' : 's'} point at workflows that do not exist — running or publishing will fail`}
              >
                {row.missingCount} missing
              </AfChip>
            ) : null}
            {typeof row.sharedCount === 'number' && row.sharedCount > 1 ? (
              <AfChip
                tone={BADGE_TONES.shared}
                size="sm"
                title={`Shared helper: used by ${row.sharedCount} workflows (this row is one view of a single flow)`}
              >
                shared ×{row.sharedCount}
              </AfChip>
            ) : null}
            {typeof row.multiplicity === 'number' && row.multiplicity > 1 ? (
              <AfChip tone={BADGE_TONES.multiplicity} size="sm" title={`Referenced ${row.multiplicity} times by this parent`}>
                ×{row.multiplicity}
              </AfChip>
            ) : null}
            {selfReferencingIds.has(flow.id) ? (
              <AfChip tone={BADGE_TONES.recursive} size="sm" title="References itself (recursion; needs a base case)">
                recursive
              </AfChip>
            ) : null}
            {cyclePromotedIds.has(flow.id) ? (
              <AfChip
                tone={BADGE_TONES.cycle}
                size="sm"
                title="Part of a reference cycle with no external parent — promoted to the top level so it stays reachable"
              >
                cycle
              </AfChip>
            ) : null}
            {isBundleTarget ? (
              <AfChip tone={BADGE_TONES.bundled} size="sm" title="Ships as a published bundle target">
                bundle
              </AfChip>
            ) : isReadonly ? (
              <AfChip tone={BADGE_TONES.bundled} size="sm" title="Bundled example (read-only)">
                bundled
              </AfChip>
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
  };

  return (
    <DisclosureList<LibraryRow>
      rows={kitRows}
      selection={selection}
      ariaLabel="Flow library"
      className="flow-library-tree"
      onSelect={(sel) => onSelect(sel.entityId, sel.rowKey)}
      onToggleExpand={(rowKey) => onToggleExpand(rowKey)}
      onActivate={(sel) => onLoad(sel.entityId)}
      renderRow={renderRow}
      scrollOnSelect={false}
      emptyLabel="No flows to show"
    />
  );
}
