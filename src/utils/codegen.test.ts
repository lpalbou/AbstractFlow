import { describe, expect, it } from 'vitest';
import type { Pin } from '../types/flow';
import { generatePythonTransformCode } from './codegen';

describe('generatePythonTransformCode keeps a body with indented blocks intact (operator 2026-10-16 17:13: "Syntax error: invalid syntax (<unknown>, line 3)")', () => {
  it('dedents by the common indentation of every line, so unindented lines survive an if: block', () => {
    const params: Pin[] = [{ id: 'input', label: 'input', type: 'any' }];
    const body = '# Available variables:\n# _input (dict)\n# input (any)\n\nmessage = "x"\n\nif input is None:\n    return message\nreturn str(input) + "\\n" + message';
    const code = generatePythonTransformCode(params, body);
    expect(code).toBe(
      'def transform(_input):\n    input = _input.get("input")\n    # Available variables:\n    # _input (dict)\n    # input (any)\n    \n    message = "x"\n    \n    if input is None:\n        return message\n    return str(input) + "\\n" + message\n'
    );
    // A body indented as a whole (pasted from inside a function) is still normalised.
    expect(generatePythonTransformCode(params, '    if input:\n        return 1\n    return 2')).toBe('def transform(_input):\n    input = _input.get("input")\n    if input:\n        return 1\n    return 2\n');
  });
});
