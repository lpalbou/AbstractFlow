# Backlog 001: Run Flow layout focus + advanced folding

## Summary
- Refocus the Run Flow form on primary workflow inputs.
- Move execution folder + session id into a folded Advanced card.
- Compact filesystem access and push it to the end of the form.

## Reason
- The Run Flow modal should prioritize fields required to start the workflow.
- Advanced execution settings should be discoverable without cluttering the main flow.

## Scope
### In
- Reorder Run Flow form fields for primary inputs first.
- Add a folded-by-default Advanced section for execution folder + session id.
- Make filesystem access more compact and actionable at the end.
- Update styles needed to support the new layout.

### Out
- Changes to backend run payload or validation logic.
- New settings or additional workflow inputs beyond layout changes.

## Dependencies
- None beyond existing Run Flow modal and styles.

## Expected outcomes
- Clearer emphasis on required run inputs.
- Advanced settings are available but not distracting.
- Filesystem controls are compact and easier to act on.

## Plan
1. Reorder Run Flow modal fields to put input pins first.
2. Add a folded Advanced section for execution folder + session id.
3. Compact filesystem access and place it at the end.
4. Update CSS for the new layout.

## Full report
### Implementation
- Restructured the Run Flow form into 3 clear cards: **Session** (top, simple, not collapsible), **File System Access** (collapsible, collapsed by default), and **Workflow Parameters** (not collapsible, holds all flow input pins).
- Renamed "Execution folder" to "Workspace folder" to match `workspace_root` semantics.
- File System Access card contains: access mode dropdown, workspace folder input, and a toggleable ignored-folders editor.
- Added CSS for label rows, section styling, and compact notes.

### Files touched
- `web/frontend/src/components/RunFlowModal.tsx`
- `web/frontend/src/styles/index.css`

### Tests
- `npm run lint` passes (web/frontend)

### Notes
- No backend changes needed; the payload structure is unchanged.
