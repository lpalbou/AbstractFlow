// Audio previews play in the kit waveform player (ui-kit 0.7.0 AfAudioPlayer),
// never a bare <audio controls>: the artifact player and the Run modal's
// generated-audio card.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { ArtifactPlayer } from './ArtifactPlayer';
import { GeneratedAudioCard } from './RunFlowModal';

function expectKitPlayer(html: string, src: string) {
  expect(html).toContain('class="af-audio');
  expect(html).toContain('role="slider"');
  expect(html).toContain('data-action="play-audio"');
  expect(html).toMatch(new RegExp(`<audio[^>]*src="${src}"`));
  expect(html).not.toMatch(/<audio[^>]*controls/);
}

describe('audio previews use the kit waveform player', () => {
  it('ArtifactPlayer audio kind', () => {
    const html = renderToStaticMarkup(
      createElement(ArtifactPlayer, { src: 'blob:http://x/a', kind: 'audio', label: 'speech.wav' })
    );
    expectKitPlayer(html, 'blob:http://x/a');
    expect(html).toContain('artifact-player-audio');
    expect(html).toContain('aria-label="Play Audio speech.wav"');
  });

  it('Run modal generated audio card', () => {
    const html = renderToStaticMarkup(
      createElement(GeneratedAudioCard, {
        preview: { artifactId: 'art1', src: 'blob:http://x/b', contentType: 'audio/wav' } as any,
        compact: true,
      })
    );
    expectKitPlayer(html, 'blob:http://x/b');
    expect(html).toContain('run-generated-audio-player');
  });
});
