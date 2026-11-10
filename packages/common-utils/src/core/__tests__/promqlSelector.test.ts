import { promqlSelectorMetricName } from '@/core/promqlSelector';

describe('promqlSelectorMetricName', () => {
  it.each([
    ['up', 'up'],
    [' node_cpu:rate5m{job="x"}', 'node_cpu:rate5m'],
    ['{__name__="up"}', 'up'],
    ['{job="x", __name__="up"}', 'up'],
    ["{job=~'a|b', env!=`x`, __name__='up'}", 'up'],
  ])('reads the metric of %s', (selector, name) => {
    expect(promqlSelectorMetricName(selector)).toBe(name);
  });

  it.each([
    '{job="x"}',
    '{__name__=~"up|down"}',
    '{job="x", __name__!="up"}',
    '{job="__name__=\\"up\\""}',
    `{job='a,__name__="up"'}`,
    '{job=`a,__name__="up"`}',
    '{__name__="a\\"b"}',
    'sum(up)',
    'up{',
  ])('returns undefined for %s', selector => {
    expect(promqlSelectorMetricName(selector)).toBeUndefined();
  });
});
