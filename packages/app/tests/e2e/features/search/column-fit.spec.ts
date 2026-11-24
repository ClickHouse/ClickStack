import { SearchPage } from '../../page-objects/SearchPage';
import { expect, test } from '../../utils/base-test';

test.describe('Search results column fit', { tag: '@search' }, () => {
  let searchPage: SearchPage;

  test.beforeEach(async ({ page }) => {
    searchPage = new SearchPage(page);
    await searchPage.goto();
  });

  test(
    'widens a column that cuts its values off when its resize handle is double-clicked',
    { tag: ['@local-mode'] },
    async () => {
      const { table } = searchPage;
      await table.dragColumnResizeHandle('ServiceName', -100);
      await expect
        .poll(() => table.countTruncatedCells('ServiceName'))
        .toBeGreaterThan(0);
      const squeezedWidth = await table.getColumnWidth('ServiceName');

      await table.fitColumnToContent('ServiceName');

      await expect.poll(() => table.countTruncatedCells('ServiceName')).toBe(0);
      expect(await table.getColumnWidth('ServiceName')).toBeGreaterThan(
        squeezedWidth,
      );
    },
  );

  test(
    'narrows a column wider than its values when its resize handle is double-clicked',
    { tag: ['@local-mode'] },
    async () => {
      const { table } = searchPage;
      await table.dragColumnResizeHandle('ServiceName', 200);
      const widenedWidth = await table.getColumnWidth('ServiceName');

      await table.fitColumnToContent('ServiceName');

      await expect
        .poll(() => table.getColumnWidth('ServiceName'))
        .toBeLessThan(widenedWidth);
      expect(await table.countTruncatedCells('ServiceName')).toBe(0);
    },
  );

  test(
    'returns the last column to filling the table',
    { tag: ['@local-mode'] },
    async () => {
      const { table } = searchPage;
      const fillWidth = await table.getColumnWidth('Body');
      await table.dragColumnResizeHandle('Body', -150);
      await expect
        .poll(() => table.getColumnWidth('Body'))
        .toBeLessThan(fillWidth);

      await table.fitColumnToContent('Body');

      await expect
        .poll(() => table.getColumnWidth('Body'))
        .toBeCloseTo(fillWidth, 0);
    },
  );

  test(
    'keeps a fitted width after a reload',
    { tag: ['@local-mode'] },
    async ({ page }) => {
      const { table } = searchPage;
      await table.dragColumnResizeHandle('ServiceName', 200);
      const widenedWidth = await table.getColumnWidth('ServiceName');
      await table.fitColumnToContent('ServiceName');
      await expect
        .poll(() => table.getColumnWidth('ServiceName'))
        .toBeLessThan(widenedWidth);
      const fittedWidth = await table.getColumnWidth('ServiceName');

      await page.reload();
      await table.waitForRowsToPopulate();

      expect(await table.getColumnWidth('ServiceName')).toBeCloseTo(
        fittedWidth,
        0,
      );
    },
  );
});
