import { describe, expect, it } from 'vitest';

import { artifactListSelectionSummary, artifactListSourceDescriptor } from './ArtifactListInputField';

describe('ArtifactListInputField source terminology', () => {
  it('describes artifact, local files, and local folder with explicit consequences', () => {
    expect(artifactListSourceDescriptor('existing')).toMatchObject({
      label: 'Artifacts',
      flowReceives: 'Files',
      reusable: 'Yes',
    });
    expect(artifactListSourceDescriptor('upload')).toMatchObject({
      label: 'Local Files',
      actionLabel: 'Choose local files',
    });
    expect(artifactListSourceDescriptor('folder')).toMatchObject({
      label: 'Local Folder',
      actionLabel: 'Choose local folder',
    });
    expect(artifactListSourceDescriptor('folder').summary).toContain('Choose one or more folders');
    expect(artifactListSourceDescriptor('folder').summary).toContain('workflow receives the files');
    expect(artifactListSourceDescriptor('folder').summary).toContain('not a live writable folder path');
  });

  it('surfaces hosted admin gating for local upload when the route is unavailable', () => {
    const descriptor = artifactListSourceDescriptor('folder', {
      upload: {
        available: false,
        denied_reason: 'admin_required',
        required_role: 'admin',
      },
    });
    expect(descriptor.access).toContain('admin/operator access');
  });

  it('summarizes selected files by source contract and selection size', () => {
    const summary = artifactListSelectionSummary(
      [
        {
          $artifact: 'art-1',
          artifact_id: 'art-1',
          run_id: 'run-1',
          filename: 'report.txt',
          source_path: 'folder/report.txt',
        },
        {
          $artifact: 'art-2',
          artifact_id: 'art-2',
          run_id: 'run-1',
          filename: 'notes.txt',
          source_path: 'folder/sub/notes.txt',
        },
      ],
      'folder'
    );

    expect(summary).toEqual(
      expect.arrayContaining([
        { label: 'Source', value: 'Local Folder' },
        { label: 'Workflow gets', value: 'Files from the selected folders' },
        { label: 'Reusable', value: 'Yes' },
        { label: 'Selected', value: '2 files selected' },
      ])
    );
  });
});
