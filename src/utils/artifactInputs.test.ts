import { describe, expect, it } from 'vitest';

import { buildFileArraySchema } from './pinTypeOptions';
import { artifactAcceptForPin, artifactMatchesPin, isArtifactListLikePin } from './artifactInputs';

describe('artifactInputs array-backed file pins', () => {
  it('treats array pins with file-item schema as artifact list inputs', () => {
    const pin = { type: 'array' as const, schema: buildFileArraySchema('artifact_image') };
    expect(isArtifactListLikePin(pin)).toBe(true);
    expect(artifactAcceptForPin(pin)).toBe('image/*');
  });

  it('matches artifact refs against array-backed file pins by modality', () => {
    const pin = { type: 'array' as const, schema: buildFileArraySchema('artifact_text') };
    expect(
      artifactMatchesPin(
        { $artifact: 'a1', content_type: 'text/plain' },
        pin
      )
    ).toBe(true);
    expect(
      artifactMatchesPin(
        { $artifact: 'a2', content_type: 'image/png' },
        pin
      )
    ).toBe(false);
  });
});
