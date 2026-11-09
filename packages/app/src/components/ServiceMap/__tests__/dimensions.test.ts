import {
  buildServiceMapDimensionsWhere,
  formatServiceMapDimensions,
  parseServiceMapGroupBy,
} from '@/components/ServiceMap/dimensions';

describe('parseServiceMapGroupBy', () => {
  it('splits on top-level commas only', () => {
    expect(
      parseServiceMapGroupBy(
        "ResourceAttributes['k8s.pod.name'], concat(a, b) ,SpanAttributes['x,y']",
      ),
    ).toEqual([
      "ResourceAttributes['k8s.pod.name']",
      'concat(a, b)',
      "SpanAttributes['x,y']",
    ]);
  });

  it('returns an empty list for a missing or blank param', () => {
    expect(parseServiceMapGroupBy(null)).toEqual([]);
    expect(parseServiceMapGroupBy(undefined)).toEqual([]);
    expect(parseServiceMapGroupBy(' ')).toEqual([]);
  });

  it('caps a hand-edited URL at three expressions', () => {
    expect(parseServiceMapGroupBy('a, b, c, d, e')).toEqual(['a', 'b', 'c']);
  });
});

describe('formatServiceMapDimensions', () => {
  it('is undefined without dimensions so nodes keep a single label line', () => {
    expect(formatServiceMapDimensions([])).toBeUndefined();
  });

  it('joins values and names an empty value explicitly', () => {
    expect(formatServiceMapDimensions(['api-pod-0', '', '/users'])).toBe(
      'api-pod-0 · (none) · /users',
    );
  });
});

describe('buildServiceMapDimensionsWhere', () => {
  it('is empty without dimensions', () => {
    expect(buildServiceMapDimensionsWhere([], [])).toBe('');
  });

  it('pins each raw expression to its escaped value', () => {
    expect(
      buildServiceMapDimensionsWhere(
        ["ResourceAttributes['k8s.pod.name']", "SpanAttributes['http.route']"],
        ['api-pod-0', "/users/'quoted'"],
      ),
    ).toBe(
      " AND ResourceAttributes['k8s.pod.name'] = 'api-pod-0' AND SpanAttributes['http.route'] = '/users/\\'quoted\\''",
    );
  });

  it('matches an empty value literally', () => {
    expect(buildServiceMapDimensionsWhere(['x'], [''])).toBe(" AND x = ''");
  });
});
