/**
 * A `SQL_QUERY` dashboard filter fills its dropdown with the first column of a
 * ClickHouse query, in the order the query returns it. It is always a
 * dashboard variable, and its query may reference the dashboard's other
 * variables and, with a source, the source macros.
 */
import { DashboardPage } from '../page-objects/DashboardPage';
import { expect, test } from '../utils/base-test';
import {
  DEFAULT_CONNECTION_NAME,
  DEFAULT_LOGS_SOURCE_NAME,
  E2E_CLICKHOUSE_DATABASE,
  E2E_LOGS_TABLE,
} from '../utils/constants';
import { expectFiltersParam } from '../utils/filters-param';

const LOGS_TABLE = `${E2E_CLICKHOUSE_DATABASE}.${E2E_LOGS_TABLE}`;
// Descending, so "query order" is distinguishable from "sorted".
const SERVICES_SQL = `SELECT ServiceName FROM ${LOGS_TABLE} WHERE $__timeFilter(Timestamp) AND ServiceName IN ('frontend', 'accounting', 'ad') GROUP BY ServiceName ORDER BY ServiceName DESC`;
const SERVICES_IN_QUERY_ORDER = ['frontend', 'ad', 'accounting'];

test.describe(
  'SQL query dashboard filters',
  { tag: ['@dashboard', '@full-stack'] },
  () => {
    let dashboardPage: DashboardPage;

    test.beforeEach(async ({ page }) => {
      dashboardPage = new DashboardPage(page);
      await dashboardPage.goto();
      await dashboardPage.createNewDashboard();
      await dashboardPage.openEditFiltersModal();
    });

    test('lists the query results in query order and stores the selection by variable name', async ({
      page,
    }) => {
      test.setTimeout(120000);
      const expected = SERVICES_IN_QUERY_ORDER;

      await test.step('Preview the values the query returns', async () => {
        await dashboardPage.openAddFilterForm();
        await dashboardPage.fillSqlQueryFilterForm({
          name: 'Service',
          connectionName: DEFAULT_CONNECTION_NAME,
          sql: SERVICES_SQL,
          variableName: 'svc',
        });
        await dashboardPage.previewSqlQueryFilter();

        await expect(dashboardPage.getSqlQueryFilterPreview()).toContainText(
          '3 values',
          { timeout: 20000 },
        );
        await expect(dashboardPage.getSqlQueryFilterPreviewValues()).toHaveText(
          expected.join(', '),
        );
      });

      await test.step('The saved filter is a SQL query variable', async () => {
        await page.getByTestId('save-filter-button').click();
        const item = dashboardPage.getFilterItemByName('Service');
        await expect(item).toContainText('SQL query');
        await expect(item).toContainText('($svc)');
        await dashboardPage.closeFiltersModal();
      });

      await test.step('The dropdown offers the values in query order', async () => {
        await dashboardPage.openFilterDropdown('Service');
        await expect(async () => {
          expect(await dashboardPage.getOpenFilterDropdownOptions()).toEqual(
            expected,
          );
        }).toPass({ timeout: 20000 });
        await page.keyboard.press('Escape');
      });

      await test.step('Selecting a value writes a variable-keyed entry that survives a reload', async () => {
        await dashboardPage.toggleFilterValue('Service', 'accounting');
        await expectFiltersParam(page, [
          { type: 'variable', name: 'svc', values: ['accounting'] },
        ]);

        await page.reload();
        await dashboardPage.waitForLoaded();
        await expect(
          dashboardPage.getFilterPill('Service', 'accounting'),
        ).toBeVisible({ timeout: 20000 });
      });
    });

    test("narrows its values by another filter's variable, reading the source table", async ({
      page,
    }) => {
      test.setTimeout(120000);

      await test.step('Create a static Group filter and a SQL query filter that reads it', async () => {
        await dashboardPage.addStaticListFilterToDashboard(
          'Group',
          ['frontend', 'ad'],
          { variableName: 'grp' },
        );
        await dashboardPage.addSqlQueryFilterToDashboard({
          name: 'Service',
          connectionName: DEFAULT_CONNECTION_NAME,
          sourceName: DEFAULT_LOGS_SOURCE_NAME,
          sql: 'SELECT DISTINCT ServiceName FROM $__sourceTable WHERE $__timeFilter(Timestamp) AND $__filter(ServiceName, $grp) ORDER BY ServiceName',
          variableName: 'svc',
        });
        await expect(
          dashboardPage.getFilterItemByName('Service'),
        ).toContainText('SQL query');
        await dashboardPage.closeFiltersModal();
      });

      await test.step('With nothing selected in Group, every service is listed', async () => {
        await dashboardPage.openFilterDropdown('Service');
        await expect(async () => {
          expect(await dashboardPage.getOpenFilterDropdownOptions()).toEqual(
            expect.arrayContaining(['accounting', 'ad', 'frontend']),
          );
        }).toPass({ timeout: 20000 });
        await page.keyboard.press('Escape');
      });

      await test.step('Selecting a Group value narrows the list to it', async () => {
        await dashboardPage.toggleFilterValue('Group', 'frontend');
        await dashboardPage.openFilterDropdown('Service');
        await expect(async () => {
          expect(await dashboardPage.getOpenFilterDropdownOptions()).toEqual([
            'frontend',
          ]);
        }).toPass({ timeout: 20000 });
        await page.keyboard.press('Escape');
      });
    });

    test('runs on the connection a connection variable selects', async ({
      page,
    }) => {
      test.setTimeout(120000);

      await test.step('Create a connection variable and a SQL query filter on it', async () => {
        await dashboardPage.addConnectionFilterToDashboard(
          'Cluster',
          'cluster',
        );
        await dashboardPage.openAddFilterForm();
        await dashboardPage.fillSqlQueryFilterForm({
          name: 'Service',
          connectionName: '$cluster',
          sql: SERVICES_SQL,
          variableName: 'svc',
        });

        // Nothing is selected in Cluster yet, so there is nothing to run on.
        await expect(
          dashboardPage
            .getFilterForm()
            .getByTestId('filter-sql-preview-button'),
        ).toBeDisabled();
        await expect(
          dashboardPage
            .getFilterForm()
            .getByText('Select a value for $cluster to preview'),
        ).toBeVisible();

        await page.getByTestId('save-filter-button').click();
        await dashboardPage.getFilterItemByName('Service').waitFor({
          state: 'visible',
          timeout: 10000,
        });
        await dashboardPage.closeFiltersModal();
      });

      await test.step('The dropdown waits for a connection', async () => {
        await expect(
          dashboardPage.getFilterPendingVariableWarning('Service'),
        ).toBeVisible({ timeout: 20000 });
      });

      await test.step('Selecting a connection fills the dropdown', async () => {
        await dashboardPage.selectReferenceFilterValue(
          'Cluster',
          DEFAULT_CONNECTION_NAME,
        );
        await expect(
          dashboardPage.getFilterPendingVariableWarning('Service'),
        ).toHaveCount(0);

        await dashboardPage.openFilterDropdown('Service');
        await expect(async () => {
          expect(await dashboardPage.getOpenFilterDropdownOptions()).toEqual(
            SERVICES_IN_QUERY_ORDER,
          );
        }).toPass({ timeout: 20000 });
        await page.keyboard.press('Escape');
      });

      await test.step('The editor previews on the selected connection, keeping the variable', async () => {
        await dashboardPage.openEditFiltersModal();
        await dashboardPage.openEditFilterForm('Service');
        await expect(
          dashboardPage
            .getFilterForm()
            .getByTestId('filter-connection-select')
            .locator('input:visible')
            .first(),
        ).toHaveValue('$cluster');

        await dashboardPage.previewSqlQueryFilter();
        await expect(dashboardPage.getSqlQueryFilterPreviewValues()).toHaveText(
          SERVICES_IN_QUERY_ORDER.join(', '),
          { timeout: 20000 },
        );
      });
    });

    test('reads the source a data source variable selects', async ({
      page,
    }) => {
      test.setTimeout(120000);

      await test.step('Create a data source variable and a SQL query filter on it', async () => {
        await dashboardPage.addDataSourceFilterToDashboard(
          'Logs source',
          ['Logs'],
          'logs',
        );
        await dashboardPage.openAddFilterForm();
        await dashboardPage.fillSqlQueryFilterForm({
          name: 'Service',
          connectionName: DEFAULT_CONNECTION_NAME,
          sourceName: '$logs',
          sql: `SELECT ServiceName FROM $__sourceTable WHERE $__timeFilter(Timestamp) AND ServiceName IN ('frontend', 'accounting', 'ad') GROUP BY ServiceName ORDER BY ServiceName DESC`,
          variableName: 'svc',
        });

        // Nothing is selected in Logs source yet, so there is no table to read.
        await expect(
          dashboardPage
            .getFilterForm()
            .getByTestId('filter-sql-preview-button'),
        ).toBeDisabled();
        await expect(
          dashboardPage
            .getFilterForm()
            .getByText('Select a value for $logs to preview'),
        ).toBeVisible();

        await page.getByTestId('save-filter-button').click();
        await dashboardPage.getFilterItemByName('Service').waitFor({
          state: 'visible',
          timeout: 10000,
        });
        await dashboardPage.closeFiltersModal();
      });

      await test.step('The dropdown waits for a source', async () => {
        await expect(
          dashboardPage.getFilterPendingVariableWarning('Service'),
        ).toBeVisible({ timeout: 20000 });
      });

      await test.step('Selecting a source fills the dropdown from its table', async () => {
        await dashboardPage.selectReferenceFilterValue(
          'Logs source',
          DEFAULT_LOGS_SOURCE_NAME,
        );
        await expect(
          dashboardPage.getFilterPendingVariableWarning('Service'),
        ).toHaveCount(0);

        await dashboardPage.openFilterDropdown('Service');
        await expect(async () => {
          expect(await dashboardPage.getOpenFilterDropdownOptions()).toEqual(
            SERVICES_IN_QUERY_ORDER,
          );
        }).toPass({ timeout: 20000 });
        await page.keyboard.press('Escape');
      });

      await test.step('The editor previews with the selected source, keeping the variable', async () => {
        await dashboardPage.openEditFiltersModal();
        await dashboardPage.openEditFilterForm('Service');
        await expect(
          dashboardPage
            .getFilterForm()
            .getByTestId('filter-sql-source-select')
            .locator('input:visible')
            .first(),
        ).toHaveValue('$logs');

        await dashboardPage.previewSqlQueryFilter();
        await expect(dashboardPage.getSqlQueryFilterPreviewValues()).toHaveText(
          SERVICES_IN_QUERY_ORDER.join(', '),
          { timeout: 20000 },
        );
      });
    });

    test("shows the query's error in the preview and on the dropdown", async ({
      page,
    }) => {
      test.setTimeout(90000);

      await test.step('The preview shows the ClickHouse error', async () => {
        await dashboardPage.openAddFilterForm();
        await dashboardPage.fillSqlQueryFilterForm({
          name: 'Broken',
          connectionName: DEFAULT_CONNECTION_NAME,
          sql: `SELECT nope FROM ${LOGS_TABLE}`,
          variableName: 'broken',
        });
        await dashboardPage.previewSqlQueryFilter();

        await expect(dashboardPage.getSqlQueryFilterPreview()).toContainText(
          'nope',
          { timeout: 20000 },
        );
      });

      await test.step('After saving, the dropdown flags the error', async () => {
        await page.getByTestId('save-filter-button').click();
        await dashboardPage.getFilterItemByName('Broken').waitFor({
          state: 'visible',
          timeout: 10000,
        });
        await dashboardPage.closeFiltersModal();

        await expect(dashboardPage.getFilterErrorIcon('Broken')).toBeVisible({
          timeout: 20000,
        });
      });
    });
  },
);
