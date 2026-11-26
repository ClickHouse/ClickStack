import { DisplayType } from '@hyperdx/common-utils/dist/types';
import { spotlight } from '@mantine/spotlight';
import { act, renderHook, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { fromPartial } from '@total-typescript/shoehorn';

import { useDashboards } from '@/dashboard';
import { useSavedSearches } from '@/savedSearch';
import { HDXSpotlightProvider, useSpotlightActions } from '@/Spotlights';
import { useUserPreferencesModal } from '@/UserPreferencesModal';
import { useUserPreferences } from '@/useUserPreferences';

const mockPush = jest.fn();

jest.mock('next/router', () => ({
  useRouter() {
    return {
      route: '/',
      pathname: '',
      query: '',
      asPath: '',
      push: mockPush,
      events: {
        on: jest.fn(),
        off: jest.fn(),
      },
      beforePopState: jest.fn(() => null),
      prefetch: jest.fn(() => null),
    };
  },
}));
jest.mock('../savedSearch');
jest.mock('../dashboard');

const mockUseSavedSearches = jest.mocked(useSavedSearches);
const mockUseDashboards = jest.mocked(useDashboards);

describe('useSpotlightActions', () => {
  const mockSavedSearches = {
    data: [
      {
        _id: '67ced5f5d02ab8b11d7f1638',
        team: '67c25ae0e3b6d5e2f2443787',
        name: 'save template1',
        select: '',
        where: '200',
        whereLanguage: 'lucene' as const,
        orderBy: '',
        source: '67c25aeee3b6d5e2f24437b3',
        tags: [],
        createdAt: '2025-03-10T12:07:17.062Z',
        updatedAt: '2025-03-10T12:07:17.062Z',
        __v: 0,
        id: '67ced5f5d02ab8b11d7f1638',
      },
    ],
  };
  const mockSavedDashboard = {
    data: [
      {
        _id: '67cfc5f7d02ab8b11d7f87c1',
        name: 'save dashboard1',
        tiles: [
          {
            id: 'c9mnw',
            x: 0,
            y: 0,
            w: 8,
            h: 10,
            config: {
              name: 'saved line',
              select: [
                {
                  aggFn: 'count',
                  aggCondition: '200',
                  aggConditionLanguage: 'lucene' as const,
                  valueExpression: '',
                },
              ],
              where: '',
              whereLanguage: 'lucene' as const,
              displayType: DisplayType.Line,
              granularity: 'auto',
              source: '67c25aeee3b6d5e2f24437b3',
            },
          },
        ],
        team: '67c25ae0e3b6d5e2f2443787',
        tags: [],
        createdAt: '2025-03-11T05:11:19.141Z',
        updatedAt: '2025-03-11T05:12:02.967Z',
        __v: 0,
        id: '67cfc5f7d02ab8b11d7f87c1',
      },
    ],
  };

  // Reset mocks before each test
  beforeEach(() => {
    jest.clearAllMocks();
    window.localStorage.clear();
    mockUseSavedSearches.mockReturnValue(fromPartial(mockSavedSearches));
    mockUseDashboards.mockReturnValue(fromPartial(mockSavedDashboard));
  });
  it('saved searches and dashboards should be loaded', () => {
    const { result } = renderHook(() => useSpotlightActions());
    expect(result.current.actions[0].id).toEqual(mockSavedSearches.data[0]._id);
    expect(result.current.actions[0].label).toEqual(
      mockSavedSearches.data[0].name,
    );
    expect(result.current.actions[1].id).toEqual(
      mockSavedDashboard.data[0]._id,
    );
    expect(result.current.actions[1].label).toEqual(
      mockSavedDashboard.data[0].name,
    );
  });

  const selectSpotlightAction = async (query: string, name: RegExp) => {
    renderWithMantine(
      <HDXSpotlightProvider>
        <div />
      </HDXSpotlightProvider>,
    );
    act(() => spotlight.open());
    await userEvent.type(await screen.findByPlaceholderText('Search'), query);
    await userEvent.click(await screen.findByRole('button', { name }));
  };

  it('opens the team settings page', async () => {
    await selectSpotlightAction('mcp', /AI agents/);

    expect(mockPush).toHaveBeenCalledWith('/team?tab=mcp');
  });

  it('opens a setting inside a team settings page', async () => {
    await selectSpotlightAction('parallelize', /Parallelize queries/);

    expect(mockPush).toHaveBeenCalledWith(
      '/team?tab=query-settings#setting-parallelizeWhenPossible',
    );
  });

  it('switches color mode without opening preferences', async () => {
    await selectSpotlightAction('light mode', /Use light mode/);

    const { result } = renderHook(() => ({
      preferences: useUserPreferences(),
      modal: useUserPreferencesModal(),
    }));
    expect(result.current.preferences.userPreferences.colorMode).toBe('light');
    expect(result.current.modal.opened).toBe(false);
  });

  it('opens the preferences modal', async () => {
    await selectSpotlightAction('time zone', /Preferences/);

    const { result } = renderHook(() => useUserPreferencesModal());
    expect(result.current.opened).toBe(true);
  });
});
