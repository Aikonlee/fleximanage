/** @jest-environment node */
// User-controlled filter text must be a literal, including metacharacters.
const { getMatchFilters, passFilters } = require('../utils/filterUtils');

const meta = 'a.b*+?^${}()|[]\\';
const invalid = '(a+)+$';

const matchOf = (filters) => getMatchFilters(filters)[0];

describe('ReDoS and regex injection hardening', () => {
  describe('metacharacter input is literal', () => {
    test('contains matches the punctuation, not a wildcard', () => {
      const filters = [{ key: 'name', op: 'contains', val: 'a.b*' }];
      expect(passFilters({ name: 'xxa.b*yy' }, filters)).toBe(true);
      expect(passFilters({ name: 'xxaXbZZZyy' }, filters)).toBe(false);
      expect(passFilters({ name: 'A.B*' }, filters)).toBe(true);

      const expr = matchOf(filters);
      expect(expr.name.test('xxa.b*yy')).toBe(true);
      expect(expr.name.test('xxaXbcyy')).toBe(false);
      expect(expr.name.source).toBe('a\\.b\\*');
    });

    test('equality is fully anchored', () => {
      const filters = [{ key: 'name', op: '==', val: meta }];
      expect(passFilters({ name: meta }, filters)).toBe(true);
      expect(passFilters({ name: meta.toUpperCase() }, filters)).toBe(true);
      expect(passFilters({ name: 'aXb*+?^${}()|[]\\' }, filters)).toBe(false);
      expect(passFilters({ name: meta + ' ' }, filters)).toBe(false);

      const expr = matchOf(filters);
      expect(expr.name.test(meta)).toBe(true);
      expect(expr.name.test('aXb*+?^${}()|[]\\')).toBe(false);
      expect(expr.name.test('z' + meta)).toBe(false);
    });

    test('inequality keeps exact passFilters and prefix match-filter semantics', () => {
      const filters = [{ key: 'name', op: '!=', val: 'a.b' }];
      expect(passFilters({ name: 'a.b' }, filters)).toBe(false);
      expect(passFilters({ name: 'A.B' }, filters)).toBe(false);
      expect(passFilters({ name: 'aXb' }, filters)).toBe(true);
      expect(passFilters({ name: 'a.b extra' }, filters)).toBe(true);

      // getFilterExpression anchors only the start for != .
      const expr = matchOf(filters);
      expect(expr.name.$not.test('a.b')).toBe(true);
      expect(expr.name.$not.test('a.b extra')).toBe(true);
      expect(expr.name.$not.test('A.B')).toBe(true);
      expect(expr.name.$not.test('aXb')).toBe(false);
      expect(expr.name.$not.test('za.b')).toBe(false);
      expect(expr.name.$not.source).toBe('^a\\.b');
    });
  });

  describe('invalid pattern input does not throw', () => {
    const values = ['(', '[', '(a+)+$', '*', '+', '?', '(?:', '\\', meta];

    test.each(values)('contains treats %p as literal text', (val) => {
      const filters = [{ key: 'name', op: 'contains', val }];
      expect(() => getMatchFilters(filters)).not.toThrow();
      expect(() => passFilters({ name: 'plain' }, filters)).not.toThrow();
      expect(passFilters({ name: 'xx' + val + 'yy' }, filters)).toBe(true);
      expect(passFilters({ name: 'plain' }, filters)).toBe(false);
      expect(matchOf(filters).name.test('xx' + val + 'yy')).toBe(true);
    });

    test('an unclosed group is an exact literal', () => {
      const filters = [{ key: 'name', op: '==', val: invalid }];
      expect(() => passFilters({ name: invalid }, filters)).not.toThrow();
      expect(passFilters({ name: invalid }, filters)).toBe(true);
      expect(passFilters({ name: 'aaa$' }, filters)).toBe(false);
      expect(matchOf(filters).name.test(invalid)).toBe(true);
      expect(matchOf(filters).name.test('aaa$')).toBe(false);
    });
  });

  describe('notContain (!contains) behavior', () => {
    test('rejects values that contain the text, ignoring case', () => {
      const filters = [{ key: 'name', op: '!contains', val: 'bad' }];
      expect(passFilters({ name: 'all good' }, filters)).toBe(true);
      expect(passFilters({ name: '' }, filters)).toBe(true);
      expect(passFilters({ name: 'bad thing' }, filters)).toBe(false);
      expect(passFilters({ name: 'the BAD word' }, filters)).toBe(false);

      const expr = matchOf(filters);
      expect(expr.name.test('all good')).toBe(true);
      expect(expr.name.test('')).toBe(true);
      expect(expr.name.test('bad thing')).toBe(false);
      expect(expr.name.test('BAD')).toBe(false);
      expect(expr.name.source).toBe('^(?!.*bad).*$');
      expect(expr.name.source).not.toContain('((?!');
    });

    test('metacharacters in !contains stay literal', () => {
      const filters = [{ key: 'desc', op: '!contains', val: 'a.b' }];
      expect(passFilters({ desc: 'axb' }, filters)).toBe(true);
      expect(passFilters({ desc: 'a.b' }, filters)).toBe(false);
      expect(passFilters({ desc: 'prefix A.B suffix' }, filters)).toBe(false);

      const expr = matchOf(filters);
      expect(expr.desc.test('axb')).toBe(true);
      expect(expr.desc.test('xa.by')).toBe(false);
      expect(expr.desc.source).toBe('^(?!.*a\\.b).*$');
    });

    test('nested-quantifier input finishes quickly and stays literal', () => {
      const filters = [{ key: 'name', op: '!contains', val: invalid }];
      const subject = 'a'.repeat(30);
      const started = Date.now();
      let present = false;
      let absent = false;
      expect(() => {
        absent = passFilters({ name: subject }, filters);
        present = passFilters({ name: subject + invalid }, filters);
        getMatchFilters(filters);
      }).not.toThrow();
      expect(absent).toBe(true);
      expect(present).toBe(false);
      expect(matchOf(filters).name.test(subject)).toBe(true);
      expect(matchOf(filters).name.test(subject + invalid)).toBe(false);
      expect(Date.now() - started).toBeLessThan(1000);
    });
  });

  test('non-regex operators keep their response shape', () => {
    expect(matchOf([{ key: 'count', op: '<', val: 5 }])).toEqual({ count: { $lt: 5 } });
    expect(passFilters({ count: 4 }, [{ key: 'count', op: '<', val: 5 }])).toBe(true);
    expect(passFilters({ count: 5 }, [{ key: 'count', op: '<', val: 5 }])).toBe(false);
    expect(matchOf([{ key: 'status', op: 'in', val: 'a,b' }])).toEqual({
      status: { $in: ['a', 'b'] }
    });

    const either = matchOf([{ key: 'a|b', op: 'contains', val: 'x.y' }]);
    expect(either.$or).toHaveLength(2);
    expect(either.$or[0].a.test('zx.y')).toBe(true);
    expect(either.$or[0].a.test('zxy')).toBe(false);
  });
});
