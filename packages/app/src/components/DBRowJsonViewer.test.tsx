import React from 'react';
import { Provider as JotaiProvider } from 'jotai';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';

import { useMaterializedAliasColumnsOption } from '@/hooks/useMaterializedAliasColumnsOption';

import {
  buildJSONExtractQuery,
  DBRowJsonViewer,
  getArrayIndexPositions,
} from './DBRowJsonViewer';
import { RowSidePanelContext } from './DBRowSidePanel';

// Mock Next.js router
jest.mock('next/router', () => ({
  __esModule: true,
  default: {
    push: jest.fn(),
  },
}));

const mockFormatTime = jest.fn();

jest.mock('@/useFormatTime', () => ({
  useFormatTime: () => mockFormatTime,
  FormatTime: jest.fn(() => null),
}));

describe('DBRowJsonViewer', () => {
  const mockGenerateSearchUrl = jest.fn();
  const mockOnPropertyAddClick = jest.fn();
  const mockToggleColumn = jest.fn();

  const defaultContext = {
    generateSearchUrl: mockGenerateSearchUrl,
    onPropertyAddClick: mockOnPropertyAddClick,
    toggleColumn: mockToggleColumn,
    displayedColumns: [],
    generateChartUrl: jest.fn(),
  };

  // Test data with consistent structure
  const logData = {
    LogAttributes: {
      field1: 'value1',
      field2: 'value2',
      nested: {
        field3: 'nested value',
      },
    },
    Timestamp: '2024-03-14 12:34:56.789',
    TimestampTime: '2024-03-14 12:34:56.789',
  };

  const spanData = {
    SpanAttributes: {
      field1: 'value1',
      field2: 'value2',
      nested: {
        field3: 'nested value',
      },
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockFormatTime.mockImplementation((time, { format } = {}) => {
      const date = time instanceof Date ? time : new Date(time);
      if (format === 'withMs') {
        return `formatted:${date.toISOString()}`;
      }
      return String(time);
    });
  });

  // Helper to render component
  const renderComponent = (data: any) => {
    return renderWithMantine(
      <RowSidePanelContext value={defaultContext}>
        <DBRowJsonViewer data={data} />
      </RowSidePanelContext>,
    );
  };

  // Line action buttons are now icon-only; locate them by their `title`
  // tooltip. Maps the friendly action name to a unique title substring.
  const ACTION_TITLE: Record<string, string> = {
    Search: 'search for this value only',
    'Add to Filters': 'add to filters',
    Column: 'column to results table',
    'Copy Object': 'copy object',
    'Copy Value': 'copy value',
  };

  const findActionButton = (line: HTMLElement, buttonText: string) => {
    const needle = (ACTION_TITLE[buttonText] ?? buttonText).toLowerCase();
    return within(line).getByTitle((content: string) =>
      (content ?? '').toLowerCase().includes(needle),
    );
  };

  // Helper to click a button on a line
  const clickLineButton = (fieldText: string, buttonText: string) => {
    const line = screen.getByText(fieldText).closest('.line')! as HTMLElement;
    fireEvent.mouseEnter(line);
    const button = findActionButton(line, buttonText);
    fireEvent.click(button);
  };

  // Helper to expand a field and click a button on a nested field
  const expandAndClickButton = (
    parentField: string,
    childField: string,
    buttonText: string,
  ) => {
    const parentLine = screen
      .getByText(parentField)
      .closest('.line')! as HTMLElement;
    fireEvent.click(parentLine);

    const childLine = screen
      .getByText(childField)
      .closest('.line')! as HTMLElement;
    fireEvent.mouseEnter(childLine);
    const button = findActionButton(childLine, buttonText);
    fireEvent.click(button);
  };

  it('formats log attributes correctly', () => {
    renderComponent(logData);
    clickLineButton('field1', 'Search');

    expect(mockGenerateSearchUrl).toHaveBeenCalledWith({
      where: "LogAttributes['field1'] = 'value1'",
      whereLanguage: 'sql',
    });
  });

  it('formats span attributes correctly', () => {
    renderComponent(spanData);
    clickLineButton('field1', 'Search');

    expect(mockGenerateSearchUrl).toHaveBeenCalledWith({
      where: "SpanAttributes['field1'] = 'value1'",
      whereLanguage: 'sql',
    });
  });

  it('handles nested paths correctly', () => {
    renderComponent(logData);
    clickLineButton('field3', 'Search');

    expect(mockGenerateSearchUrl).toHaveBeenCalledWith({
      where: "LogAttributes['nested']['field3'] = 'nested value'",
      whereLanguage: 'sql',
    });
  });

  it('handles empty attributes correctly', () => {
    renderComponent({});
    expect(screen.queryByText('Search')).toBeNull();
  });

  it('adds filters with correct path formatting', () => {
    renderComponent(logData);
    clickLineButton('field1', 'Add to Filters');

    expect(mockOnPropertyAddClick).toHaveBeenCalledWith(
      "LogAttributes['field1']",
      'value1',
    );
  });

  // HDX-4427: "Add to Filters" on a value inside parsed JSON from a String
  // column must hand searchFilters the JSONExtract* expression, which is what
  // gets serialized into the WHERE clause. Body here is a String column holding
  // a JSON string with a dotted key, mirroring the play-clickstack repro.
  it('adds a JSONExtractString filter for a value inside a parsed-JSON string column', () => {
    renderComponent({ Body: JSON.stringify({ 'app.user.currency': 'USD' }) });

    expandAndClickButton('Body', 'app.user.currency', 'Add to Filters');

    expect(mockOnPropertyAddClick).toHaveBeenCalledWith(
      "JSONExtractString(Body, 'app.user.currency')",
      'USD',
    );
  });

  it('toggles columns with correct path formatting', () => {
    renderComponent(logData);
    clickLineButton('field1', 'Column');

    expect(mockToggleColumn).toHaveBeenCalledWith("LogAttributes['field1']");
  });

  it('turns the materialized and alias columns option on and off from the menu', async () => {
    const OptionValue = () => (
      <span data-testid="materialized-alias-option">
        {String(useMaterializedAliasColumnsOption()[0])}
      </span>
    );
    const { container } = renderWithMantine(
      <RowSidePanelContext value={defaultContext}>
        <DBRowJsonViewer data={logData} showMaterializedAliasColumnsOption />
        <OptionValue />
      </RowSidePanelContext>,
    );
    const option = screen.getByTestId('materialized-alias-option');
    const toggle = async () => {
      fireEvent.click(container.querySelector('[aria-haspopup="menu"]')!);
      fireEvent.click(
        await screen.findByTestId('json-viewer-materialized-alias-toggle'),
      );
    };

    expect(option).toHaveTextContent('false');
    await toggle();
    expect(option).toHaveTextContent('true');
    expect(
      localStorage.getItem('hdx-row-show-materialized-alias-columns'),
    ).toBe('true');
    await toggle();
    expect(option).toHaveTextContent('false');
  });

  it('hides the materialized and alias columns option unless asked to show it', async () => {
    const { container } = renderComponent(logData);
    fireEvent.click(container.querySelector('[aria-haspopup="menu"]')!);

    expect(await screen.findByText('Hide blank values')).toBeInTheDocument();
    expect(
      screen.queryByTestId('json-viewer-materialized-alias-toggle'),
    ).not.toBeInTheDocument();
  });

  describe('timestamp fields', () => {
    it('displays Timestamp using the same formatter as the results table', () => {
      renderComponent({
        Timestamp: '2026-06-15T02:23:15.895Z',
      });

      expect(
        screen.queryByText('2026-06-15T02:23:15.895Z'),
      ).not.toBeInTheDocument();
      expect(
        screen.getByText('formatted:2026-06-15T02:23:15.895Z'),
      ).toBeInTheDocument();
      expect(mockFormatTime).toHaveBeenCalledWith(
        expect.any(Date),
        expect.objectContaining({ format: 'withMs' }),
      );
    });

    it('does not reformat nested Timestamp attributes', () => {
      renderComponent({
        LogAttributes: {
          Timestamp: '2026-06-15T02:23:15.895Z',
        },
      });

      expect(screen.getByText('2026-06-15T02:23:15.895Z')).toBeInTheDocument();
    });

    it.each([['Timestamp'], ['TimestampTime']])(
      'formats %s field correctly',
      field => {
        renderComponent(logData);
        clickLineButton(field, 'Search');

        expect(mockGenerateSearchUrl).toHaveBeenCalledWith({
          where: `${field} = parseDateTime64BestEffort('2024-03-14 12:34:56.789', 9)`,
          whereLanguage: 'sql',
        });
      },
    );
  });

  // The rendered array index becomes a ClickHouse subscript, so it must be the
  // element's real position even when the viewer has filtered the tree.
  describe('JSON column arrays in a filtered tree', () => {
    const mockClipboard = jest.fn();

    beforeEach(() => {
      Object.assign(navigator, {
        clipboard: { writeText: mockClipboard },
      });
    });

    afterEach(() => {
      localStorage.removeItem('hdx_json_viewer_options');
    });

    // A fresh jotai store per test keeps the stored viewer options from
    // leaking between tests.
    const renderJsonRow = (data: any) =>
      renderWithMantine(
        <JotaiProvider>
          <RowSidePanelContext value={defaultContext}>
            <DBRowJsonViewer data={data} jsonColumns={['message']} />
          </RowSidePanelContext>
        </JotaiProvider>,
      );

    const toggleHideBlanks = async (container: HTMLElement) => {
      fireEvent.click(container.querySelector('[aria-haspopup="menu"]')!);
      fireEvent.click(await screen.findByText('Hide blank values'));
    };

    const rowWithBlankElement = {
      message: { events: [{ name: '' }, { name: 'second' }] },
    };

    it('keeps the real index of an element after a blank one is hidden', async () => {
      const { container } = renderJsonRow(rowWithBlankElement);
      await toggleHideBlanks(container);

      expect(screen.getByText('[] 1 items')).toBeInTheDocument();
      clickLineButton('name', 'Add to Filters');
      expect(mockOnPropertyAddClick).toHaveBeenCalledWith(
        'toString(message.`events`[2].`name`)',
        'second',
      );
    });

    it('copies the row without nulls for hidden blank elements', async () => {
      const { container } = renderJsonRow(rowWithBlankElement);
      await toggleHideBlanks(container);

      fireEvent.click(screen.getByTitle('Copy row as JSON'));
      expect(mockClipboard).toHaveBeenCalledWith(
        JSON.stringify({ message: { events: [{ name: 'second' }] } }, null, 2),
      );
    });

    it('copies an array without nulls for hidden blank elements', async () => {
      const { container } = renderJsonRow(rowWithBlankElement);
      await toggleHideBlanks(container);

      clickLineButton('events', 'Copy Object');
      expect(mockClipboard).toHaveBeenCalledWith(
        JSON.stringify([{ name: 'second' }], null, 2),
      );
    });

    it('uses a subscript for an array element while the property search is active', async () => {
      renderJsonRow({
        message: { events: [{ name: 'first' }, { name: 'second' }] },
      });
      fireEvent.change(
        screen.getByPlaceholderText('Search properties by key or value'),
        { target: { value: 'second' } },
      );
      await waitFor(() => expect(screen.queryByText('first')).toBeNull());

      clickLineButton('name', 'Add to Filters');
      expect(mockOnPropertyAddClick).toHaveBeenCalledWith(
        'toString(message.`events`[2].`name`)',
        'second',
      );
    });
  });

  describe('copy functionality', () => {
    const mockClipboard = jest.fn();

    beforeEach(() => {
      Object.assign(navigator, {
        clipboard: { writeText: mockClipboard },
      });
    });

    it('copies array elements from expanded stringified JSON', () => {
      const arrayObject = { status: 'True', type: 'PodReady' };
      const data = { conditions: JSON.stringify([arrayObject]) };

      renderComponent(data);
      expandAndClickButton('conditions', '0', 'Copy Object');

      expect(mockClipboard).toHaveBeenCalledWith(
        JSON.stringify(arrayObject, null, 2),
      );
    });

    it('copies entire stringified value when not expanded', () => {
      const arrayData = [{ type: 'Ready' }, { type: 'Init' }];
      const data = { conditions: JSON.stringify(arrayData) };

      renderComponent(data);
      clickLineButton('conditions', 'Copy Value');

      expect(mockClipboard).toHaveBeenCalledWith(JSON.stringify(arrayData));
    });

    it('copies regular nested objects', () => {
      renderComponent(logData);
      clickLineButton('nested', 'Copy Object');

      expect(mockClipboard).toHaveBeenCalledWith(
        JSON.stringify({ field3: 'nested value' }, null, 2),
      );
    });
  });

  describe('buildJSONExtractQuery', () => {
    it('returns null when keyPath equals parsedJsonRootPath (no nested path)', () => {
      expect(
        buildJSONExtractQuery(['LogAttributes'], ['LogAttributes']),
      ).toBeNull();
    });

    it('returns null when keyPath is shorter than parsedJsonRootPath', () => {
      expect(buildJSONExtractQuery([], ['LogAttributes'])).toBeNull();
    });

    it('builds query for single-level path with default JSONExtractString', () => {
      expect(
        buildJSONExtractQuery(['LogAttributes', 'field1'], ['LogAttributes']),
      ).toBe("JSONExtractString(LogAttributes, 'field1')");
    });

    it('builds query for nested path', () => {
      expect(
        buildJSONExtractQuery(
          ['LogAttributes', 'nested', 'field3'],
          ['LogAttributes'],
        ),
      ).toBe("JSONExtractString(LogAttributes, 'nested', 'field3')");
    });

    it('uses JSONExtractFloat when specified', () => {
      expect(
        buildJSONExtractQuery(
          ['SpanAttributes', 'count'],
          ['SpanAttributes'],
          [],
          'JSONExtractFloat',
        ),
      ).toBe("JSONExtractFloat(SpanAttributes, 'count')");
    });

    it('uses JSONExtractBool when specified', () => {
      expect(
        buildJSONExtractQuery(
          ['LogAttributes', 'enabled'],
          ['LogAttributes'],
          [],
          'JSONExtractBool',
        ),
      ).toBe("JSONExtractBool(LogAttributes, 'enabled')");
    });

    it('handles path segments that look like array indices', () => {
      expect(
        buildJSONExtractQuery(['LogAttributes', '0', 'id'], ['LogAttributes']),
      ).toBe("JSONExtractString(LogAttributes, '0', 'id')");
    });

    it('uses full column path for Map column with parsed JSON value', () => {
      expect(
        buildJSONExtractQuery(
          ['LogAttributes', 'config', 'host'],
          ['LogAttributes', 'config'],
        ),
      ).toBe("JSONExtractString(LogAttributes['config'], 'host')");
    });

    it('uses full column path for deeply nested Map column with parsed JSON', () => {
      expect(
        buildJSONExtractQuery(
          ['LogAttributes', 'config', 'database', 'host'],
          ['LogAttributes', 'config'],
        ),
      ).toBe("JSONExtractString(LogAttributes['config'], 'database', 'host')");
    });

    it('uses JSON dot notation for JSON column with parsed JSON value', () => {
      expect(
        buildJSONExtractQuery(
          ['LogAttributes', 'config', 'host'],
          ['LogAttributes', 'config'],
          ['LogAttributes'],
        ),
      ).toBe("JSONExtractString(toString(LogAttributes.`config`), 'host')");
    });

    it('passes array positions in the parsed JSON as 1-based integers', () => {
      expect(
        buildJSONExtractQuery(
          ['Body', 'events', '0', 'name'],
          ['Body'],
          [],
          'JSONExtractString',
          [],
          new Set([2]),
        ),
      ).toBe("JSONExtractString(Body, 'events', 1, 'name')");
    });

    it('subscripts a JSON-column array element holding parsed JSON', () => {
      expect(
        buildJSONExtractQuery(
          ['message', 'events', '1', 'payload', 'k'],
          ['message', 'events', '1', 'payload'],
          ['message'],
          'JSONExtractString',
          [],
          new Set([2]),
        ),
      ).toBe("JSONExtractString(toString(message.`events`[2].`payload`), 'k')");
    });

    // HDX-4369. HyperJson promotes a Map sub-value that is itself a
    // JSON-parseable string to `isInParsedJson=true` with
    // parsedJsonRootPath=[MapCol, key] (see HyperJson.tsx:227-234). When that
    // key is numeric, the inner `mergePath` used to emit `MapCol[N+1]` array
    // syntax, which ClickHouse rejects with "Illegal types of arguments:
    // Map(String, String), UInt8 for function arrayElement". Threading
    // `mapColumns` keeps the Map[\'1\'] subscript.
    it("emits Map['1'] for Map column with numeric sub-key holding parsed JSON", () => {
      expect(
        buildJSONExtractQuery(
          ['LogAttributes', '1', 'foo'],
          ['LogAttributes', '1'],
          [], // jsonColumns
          'JSONExtractString',
          ['LogAttributes'], // mapColumns
        ),
      ).toBe("JSONExtractString(LogAttributes['1'], 'foo')");
    });

    it("emits Map['42'] for deeply nested Map column with numeric sub-key holding parsed JSON", () => {
      expect(
        buildJSONExtractQuery(
          ['LogAttributes', '42', 'bar', 'baz'],
          ['LogAttributes', '42'],
          [],
          'JSONExtractString',
          ['LogAttributes'],
        ),
      ).toBe("JSONExtractString(LogAttributes['42'], 'bar', 'baz')");
    });

    it('keeps non-numeric Map sub-key unchanged when mapColumns is threaded', () => {
      expect(
        buildJSONExtractQuery(
          ['LogAttributes', 'config', 'host'],
          ['LogAttributes', 'config'],
          [],
          'JSONExtractString',
          ['LogAttributes'],
        ),
      ).toBe("JSONExtractString(LogAttributes['config'], 'host')");
    });

    it('falls back to array index when mapColumns is empty (unchanged behavior)', () => {
      // Without mapColumns, a numeric segment still gets the array-index
      // treatment. This pins the pre-HDX-4369 default for the non-Map case
      // (e.g. an Array(JSON) column whose element holds a parsed JSON value).
      expect(
        buildJSONExtractQuery(['SomeArray', '0', 'id'], ['SomeArray', '0']),
      ).toBe("JSONExtractString(SomeArray[1], 'id')");
    });
  });
});

describe('getArrayIndexPositions', () => {
  const row = {
    message: {
      events: [
        { detail: { parameters: [{ name: 'a' }, { name: 'b', value: 'x' }] } },
      ],
      counts: { '200': { n: 1 } },
    },
  };

  it('marks the path positions whose parent is an array', () => {
    expect(
      Array.from(
        getArrayIndexPositions(row, [
          'message',
          'events',
          '0',
          'detail',
          'parameters',
          '1',
          'value',
        ]),
      ),
    ).toEqual([2, 5]);
  });

  it('does not mark numeric keys of a plain object', () => {
    expect(
      Array.from(
        getArrayIndexPositions(row, ['message', 'counts', '200', 'n']),
      ),
    ).toEqual([]);
  });

  it('descends into string values that hold JSON', () => {
    expect(
      Array.from(
        getArrayIndexPositions({ Body: '{"events":[{"name":"x"}]}' }, [
          'Body',
          'events',
          '0',
          'name',
        ]),
      ),
    ).toEqual([2]);
  });

  it('returns an empty set for a missing path', () => {
    expect(getArrayIndexPositions(row, ['nope', '0']).size).toBe(0);
  });
});
