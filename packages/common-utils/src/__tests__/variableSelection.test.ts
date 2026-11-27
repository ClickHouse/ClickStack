import type { ChartVariable } from '@/types';
import {
  ALL_SELECTION,
  expandAllSelections,
  isAllSelection,
  selectionHasValue,
} from '@/variableSelection';

describe('isAllSelection', () => {
  it('holds only for the "all" marker', () => {
    expect(isAllSelection(ALL_SELECTION)).toBe(true);
    expect(isAllSelection(['a'])).toBe(false);
    expect(isAllSelection([])).toBe(false);
    expect(isAllSelection(undefined)).toBe(false);
  });
});

describe('selectionHasValue', () => {
  it('holds for "all" and for a non-empty list', () => {
    expect(selectionHasValue(ALL_SELECTION)).toBe(true);
    expect(selectionHasValue(['a'])).toBe(true);
  });

  it('treats an empty list like no selection', () => {
    expect(selectionHasValue([])).toBe(false);
    expect(selectionHasValue(undefined)).toBe(false);
  });
});

describe('expandAllSelections', () => {
  const env: ChartVariable = { name: 'env', values: [], all: true };
  const region: ChartVariable = { name: 'region', values: ['eu'] };

  it('fills an "all" variable with its sorted options', () => {
    expect(
      expandAllSelections(
        [env, region],
        new Map([
          ['env', ['staging', 'prod']],
          ['region', ['us', 'eu']],
        ]),
      ),
    ).toEqual([
      { name: 'env', values: ['prod', 'staging'], all: true },
      region,
    ]);
  });

  it('leaves an "all" variable empty until its options are known', () => {
    expect(expandAllSelections([env], new Map())).toEqual([env]);
  });

  it('does not mutate the options it was given', () => {
    const options = ['staging', 'prod'];
    expandAllSelections([env], new Map([['env', options]]));
    expect(options).toEqual(['staging', 'prod']);
  });
});
