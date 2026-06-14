import { describe, expect, it } from 'vitest';

import { artifactSelectionSummary, artifactSourceDescriptor } from './ArtifactInputField';

describe('ArtifactInputField source terminology', () => {
  it('describes artifact, local file, and server file with explicit consequences', () => {
    expect(artifactSourceDescriptor('existing')).toMatchObject({
      label: 'Artifact',
      flowReceives: 'One file',
      reusable: 'Yes',
    });
    expect(artifactSourceDescriptor('upload')).toMatchObject({
      label: 'Local File',
      actionLabel: 'Choose local file',
    });
    expect(artifactSourceDescriptor('workspace')).toMatchObject({
      label: 'Server File',
      actionLabel: 'Import server file',
      placeholder: 'workspace-relative/or-mount/path.ext',
    });
  });

  it('surfaces hosted admin gating for server file import', () => {
    const descriptor = artifactSourceDescriptor('workspace', {
      import: {
        available: false,
        denied_reason: 'admin_required',
        required_role: 'admin',
      },
    });
    expect(descriptor.access).toContain('admin/operator workspace access');
  });

  it('summarizes selected artifacts by source contract and reference', () => {
    const summary = artifactSelectionSummary('workspace', {
      $artifact: 'art-1',
      artifact_id: 'art-1',
      run_id: 'run-1',
      content_type: 'text/plain',
      modality: 'text',
      filename: 'notes.txt',
      source_path: 'mount_abcd1234/notes.txt',
    });
    expect(summary).toEqual(
      expect.arrayContaining([
        { label: 'Source', value: 'Server File' },
        { label: 'Workflow gets', value: 'One file' },
        { label: 'Reusable', value: 'Yes' },
        { label: 'Reference', value: 'mount_abcd1234/notes.txt' },
      ])
    );
  });
});
