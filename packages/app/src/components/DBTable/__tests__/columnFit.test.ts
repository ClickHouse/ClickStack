import {
  getFittedColumnWidth,
  measureColumnContentWidth,
} from '@/components/DBTable/columnFit';

const CHAR_WIDTH = 8;

// jsdom does no layout. The hidden copies the helper measures report 8px per
// character of text; every other element reports the width in its inline
// style.
function mockLayout() {
  return jest
    .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
    .mockImplementation(function (this: HTMLElement) {
      const width =
        this.style.visibility === 'hidden'
          ? (this.textContent ?? '').length * CHAR_WIDTH
          : parseFloat(this.style.width) || 0;
      return {
        width,
        height: 0,
        top: 0,
        left: 0,
        right: width,
        bottom: 0,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      };
    });
}

function renderTable(html: string) {
  const table = document.createElement('table');
  table.innerHTML = html;
  document.body.append(table);
  return table;
}

const headerCell = (columnId: string, label: string, padding = 0) =>
  `<th data-column-id="${columnId}" style="width: 160px"><div style="width: ${160 - padding}px">${label}</div></th>`;

const bodyCell = (columnId: string, value: string) =>
  `<td><div data-column-id="${columnId}" style="width: 160px"><div style="width: 160px">${value}</div></div></td>`;

describe('measureColumnContentWidth', () => {
  let rectSpy: jest.SpyInstance;

  beforeEach(() => {
    rectSpy = mockLayout();
  });

  afterEach(() => {
    rectSpy.mockRestore();
    document.body.innerHTML = '';
  });

  it('returns the widest of the header and the rendered cells of the column', () => {
    const table = renderTable(`
      <thead><tr>${headerCell('service', 'Service')}${headerCell('body', 'Body')}</tr></thead>
      <tbody>
        <tr>${bodyCell('service', 'api')}${bodyCell('body', 'a much longer value in another column')}</tr>
        <tr>${bodyCell('service', 'checkout-service')}${bodyCell('body', 'short')}</tr>
      </tbody>
    `);

    expect(measureColumnContentWidth(table, 'service')).toBe(
      'checkout-service'.length * CHAR_WIDTH,
    );
  });

  it('adds the padding the cell keeps around its content', () => {
    const table = renderTable(`
      <thead><tr>${headerCell('level', 'Level', 8)}</tr></thead>
      <tbody><tr>${bodyCell('level', 'warn')}</tr></tbody>
    `);

    expect(measureColumnContentWidth(table, 'level')).toBe(
      'Level'.length * CHAR_WIDTH + 8,
    );
  });

  it('skips cells of a table nested in an expanded row', () => {
    const table = renderTable(`
      <tbody>
        <tr>${bodyCell('service', 'api')}</tr>
        <tr><td><table><tbody><tr>${bodyCell('service', 'nested-table-service')}</tr></tbody></table></td></tr>
      </tbody>
    `);

    expect(measureColumnContentWidth(table, 'service')).toBe(
      'api'.length * CHAR_WIDTH,
    );
  });

  it('leaves the table as it found it', () => {
    const table = renderTable(
      `<tbody><tr>${bodyCell('service', 'api')}</tr></tbody>`,
    );
    const html = table.innerHTML;

    measureColumnContentWidth(table, 'service');

    expect(table.innerHTML).toBe(html);
  });

  it('removes its copies even when reading a width throws', () => {
    const table = renderTable(
      `<tbody><tr>${bodyCell('service', 'api')}</tr></tbody>`,
    );
    const html = table.innerHTML;
    rectSpy.mockImplementation(() => {
      throw new Error('layout failed');
    });

    expect(() => measureColumnContentWidth(table, 'service')).toThrow(
      'layout failed',
    );
    expect(table.innerHTML).toBe(html);
  });

  it('returns 0 when the column has no cells', () => {
    const table = renderTable(
      `<tbody><tr>${bodyCell('service', 'api')}</tr></tbody>`,
    );

    expect(measureColumnContentWidth(table, 'body')).toBe(0);
  });
});

describe('getFittedColumnWidth', () => {
  it('rounds the content width up so the content is not cut off', () => {
    expect(getFittedColumnWidth(101.2, 1400)).toBe(102);
  });

  it('keeps at least the minimum column width', () => {
    expect(getFittedColumnWidth(12, 1400)).toBe(50);
  });

  it('caps the width at 600px', () => {
    expect(getFittedColumnWidth(2000, 1600)).toBe(600);
  });

  it('caps the width at half the visible table width when that is smaller', () => {
    expect(getFittedColumnWidth(2000, 800)).toBe(400);
  });

  it('never caps below the minimum column width', () => {
    expect(getFittedColumnWidth(2000, 60)).toBe(50);
  });
});
