import { describe, expect, it } from 'vitest';

import { PIN_INFO, PIN_RULES } from './PinLegend';

describe('PinLegend terminology', () => {
  it('describes file pins as durable saved file references', () => {
    const file = PIN_INFO.find((item) => item.type === 'artifact');
    const imageFile = PIN_INFO.find((item) => item.type === 'artifact_image');
    const fileArray = PIN_INFO.find((item) => item.type === 'artifacts');
    expect(file?.label).toBe('File');
    expect(file?.description).toContain('Saved file value');
    expect(imageFile?.label).toBe('Image File');
    expect(imageFile?.description).toContain('Durable saved image file reference');
    expect(fileArray).toBeUndefined();
  });

  it('keeps the live server-path distinction visible in the rules', () => {
    expect(PIN_RULES).toContain(
      'Server File and Server Folder are live server workspace paths and remain string-compatible for backward compatibility'
    );
  });

  it('treats multiple file references as array workflows in the rules', () => {
    expect(PIN_RULES).toContain(
      'Use array of file for multiple local files or for local folder contents'
    );
    expect(PIN_RULES).toContain(
      'Local Folder in the run form is a source for array<file>, not a live writable folder path'
    );
  });
});
