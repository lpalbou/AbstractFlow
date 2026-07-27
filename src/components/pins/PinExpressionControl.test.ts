import { describe, it, expect } from 'vitest';
import {
  libraryCallName,
  extractVarReads,
  scanVarReads,
  planPromotion,
  maskStringLiterals,
} from './PinExpressionControl';

/**
 * Pins the tier-2 promote/chip correctness the adversary review found broken
 * (P1-3 string mangling, P1-4 duplicate `value` param, P1-5 vars.get, P1-7
 * chip prefix-honesty). Nothing pinned these before; every case below is a
 * confirmed defect that must stay fixed.
 */

describe('maskStringLiterals', () => {
  it('blanks string contents, preserves length + non-string structure', () => {
    const src = 'a + "vars.phase" + b';
    const masked = maskStringLiterals(src);
    expect(masked.length).toBe(src.length);
    expect(masked.startsWith('a + ')).toBe(true);
    expect(masked).not.toContain('vars.phase');
    expect(masked.endsWith(' + b')).toBe(true);
  });

  it('handles triple quotes and escapes', () => {
    expect(maskStringLiterals('x + """a"b""" + y')).not.toContain('a"b');
    expect(maskStringLiterals("f('it\\'s') + z").endsWith(' + z')).toBe(true);
  });
});

describe('libraryCallName — whole-expression honesty (P1-7)', () => {
  const lib = ['build_again', 'should_retry'];
  it('recognizes a pure whole-expression call', () => {
    expect(libraryCallName('build_again(vars.state, 3)', lib)).toBe('build_again');
  });
  it('does NOT claim a call for a compound expression that merely starts with one', () => {
    expect(libraryCallName('build_again(vars.a) or vars.force', lib)).toBeNull();
    expect(libraryCallName('not build_again(vars.a)', lib)).toBeNull();
  });
  it('is not fooled by a close-paren inside a string literal', () => {
    expect(libraryCallName('build_again(")") ', lib)).toBe('build_again');
    expect(libraryCallName('build_again(vars.a) + ")"', lib)).toBeNull();
  });
  it('returns null for an unknown name or a non-call', () => {
    expect(libraryCallName('unknown_fn(x)', lib)).toBeNull();
    expect(libraryCallName('vars.state', lib)).toBeNull();
  });
});

describe('scanVarReads — string- and method-aware (P1-3, P1-5)', () => {
  it('finds simple attribute and subscript reads', () => {
    expect(extractVarReads('vars.a + vars["b"] + vars.a')).toEqual(['a', 'b']);
  });
  it('ignores vars.* inside string literals', () => {
    expect(extractVarReads('vars.phase == "vars.phase"')).toEqual(['phase']);
  });
  it('refuses (returns null) on a method call like vars.get(...)', () => {
    expect(scanVarReads('vars.get("x")')).toBeNull();
    expect(scanVarReads('vars.items()')).toBeNull();
  });
  it('refuses on dynamic subscript or bare vars', () => {
    expect(scanVarReads('vars[key]')).toBeNull();
    expect(scanVarReads('len(vars)')).toBeNull();
  });
});

describe('planPromotion — generator correctness', () => {
  it('parameterizes simple reads and keeps meaning (happy path)', () => {
    const plan = planPromotion('vars.build_state["phase"] == "fixing" and vars.fix_cycles < 3', 'should_retry');
    expect(plan.error).toBeUndefined();
    expect(plan.params).toEqual(['build_state', 'fix_cycles']);
    expect(plan.call).toBe('should_retry(vars.build_state, vars.fix_cycles)');
    // The def body substituted the reads, not the string literal.
    expect(plan.code).toContain('def should_retry(build_state, fix_cycles):');
    expect(plan.code).toContain('"fixing"');
    expect(plan.code).not.toContain('vars.');
  });

  it('P1-3: does not mangle a vars.* token inside a string literal', () => {
    const plan = planPromotion('vars.phase == "vars.phase"', 'eq');
    expect(plan.error).toBeUndefined();
    expect(plan.params).toEqual(['phase']);
    // The literal is preserved; only the real read became a parameter.
    expect(plan.code).toContain('phase == "vars.phase"');
    expect(plan.call).toBe('eq(vars.phase)');
  });

  it('P1-4: refuses a run var named value (would be a duplicate parameter)', () => {
    const plan = planPromotion('vars.value > value', 'cmp');
    expect(plan.error).toMatch(/value.*collides|collides.*value/);
    expect(plan.code).toBe('');
  });

  it('adds a value parameter when the pin value is read', () => {
    const plan = planPromotion('value["k"] > vars.threshold', 'over');
    expect(plan.error).toBeUndefined();
    expect(plan.params).toEqual(['threshold', 'value']);
    expect(plan.call).toBe('over(vars.threshold, value)');
  });

  it('P1-5: refuses dynamic vars use (vars.get)', () => {
    const plan = planPromotion('vars.get("x", 0) < 3', 'chk');
    expect(plan.error).toMatch(/dynamically/);
  });
});
