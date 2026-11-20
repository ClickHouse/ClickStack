import { DashboardPage } from '../page-objects/DashboardPage';
import { DashboardsListPage } from '../page-objects/DashboardsListPage';
import { expect, test } from '../utils/base-test';
import { DEFAULT_LOGS_SOURCE_NAME } from '../utils/constants';

test.describe('Temporary Dashboard', { tag: ['@dashboard'] }, () => {
  let dashboardPage: DashboardPage;
  let dashboardsListPage: DashboardsListPage;

  test.beforeEach(async ({ page }) => {
    dashboardPage = new DashboardPage(page);
    dashboardsListPage = new DashboardsListPage(page);
  });

  test(
    'should navigate from listing page to temporary dashboard',
    { tag: '@full-stack' },
    async () => {
      await dashboardsListPage.goto();

      await test.step('Click New Dashboard and select Temporary Dashboard', async () => {
        await dashboardsListPage.goToTempDashboard();
      });

      await test.step('Verify the temporary dashboard banner is visible', async () => {
        await expect(dashboardPage.temporaryDashboardBanner).toBeVisible();
        await expect(dashboardPage.temporaryDashboardBanner).toContainText(
          'This is currently an unsaved, temporary dashboard.',
        );
        await expect(dashboardPage.createButton).toHaveText('Save dashboard');
      });
    },
  );

  test(
    'should persist temporary dashboard content in URL params across navigation',
    {},
    async ({ page }) => {
      await dashboardPage.goto();

      await test.step('Verify the temporary dashboard banner is visible', async () => {
        await expect(dashboardPage.temporaryDashboardBanner).toBeVisible();
      });

      await test.step('Add a tile to the temporary dashboard', async () => {
        await dashboardPage.addTile();
        await dashboardPage.chartEditor.createBasicChart('Temp Chart');
      });

      await test.step('Verify the tile and chart render', async () => {
        await expect(dashboardPage.getTiles()).toHaveCount(1, {
          timeout: 10000,
        });
        await expect(dashboardPage.getChartContainers()).toHaveCount(1, {
          timeout: 10000,
        });
      });

      let savedUrl: string;

      await test.step('Verify the URL contains the dashboard query param', async () => {
        savedUrl = page.url();
        expect(savedUrl).toContain('dashboard=');
      });

      await test.step('Navigate away to /search', async () => {
        await page.goto('/search');
        await expect(page).toHaveURL(/\/search/);
      });

      await test.step('Navigate back and verify persistence', async () => {
        await page.goto(savedUrl);
        await expect(dashboardPage.getTiles()).toHaveCount(1, {
          timeout: 10000,
        });
        await expect(dashboardPage.getChartContainers().first()).toBeVisible({
          timeout: 10000,
        });
      });
    },
  );

  test(
    'should carry tiles, title, filters, and saved filters into the saved dashboard',
    { tag: '@full-stack' },
    async ({ page }) => {
      const uniqueName = `Saved From Temp ${Date.now()}`;
      const savedQuery = 'SeverityText:error';

      await dashboardPage.goto();

      await test.step('Verify the temporary dashboard banner is visible', async () => {
        await expect(dashboardPage.temporaryDashboardBanner).toBeVisible();
      });

      await test.step('Rename the temporary dashboard', async () => {
        await dashboardPage.renameDashboard('My New Dashboard', uniqueName);
      });

      await test.step('Add a tile', async () => {
        await dashboardPage.addTile();
        await dashboardPage.chartEditor.createBasicChart('Temp tile');
        await expect(dashboardPage.getTiles()).toHaveCount(1, {
          timeout: 10000,
        });
      });

      await test.step('Add a dashboard filter', async () => {
        await dashboardPage.openEditFiltersModal();
        await expect(dashboardPage.emptyFiltersList).toBeVisible();
        await dashboardPage.addFilterToDashboard(
          'Service',
          DEFAULT_LOGS_SOURCE_NAME,
          'ServiceName',
        );
        await expect(
          dashboardPage.getFilterItemByName('Service'),
        ).toBeVisible();
        await dashboardPage.closeFiltersModal();
      });

      await test.step('Select a filter value and enter a search query', async () => {
        await dashboardPage.clickFilterOption('Service', 'accounting');
        await expect(
          dashboardPage
            .getFilterSelectByName('Service')
            .locator('..')
            .getByText('accounting'),
        ).toBeVisible();
        await dashboardPage.setGlobalFilter(savedQuery);
      });

      await test.step('Save the temporary dashboard', async () => {
        await dashboardPage.createButton.click();
        await expect(page).toHaveURL(/\/dashboards\/.+/, { timeout: 10000 });
      });

      await test.step('Verify the temporary banner is replaced by breadcrumbs', async () => {
        await expect(dashboardPage.temporaryDashboardBanner).toBeHidden();
        await expect(
          page
            .getByTestId('dashboard-page')
            .getByRole('link', { name: 'Dashboards' }),
        ).toBeVisible();
      });

      await test.step('Verify the title carried over', async () => {
        await expect(dashboardPage.dashboardName).toHaveValue(uniqueName, {
          timeout: 10000,
        });
      });

      await test.step('Verify the tile carried over', async () => {
        await expect(dashboardPage.getTiles()).toHaveCount(1, {
          timeout: 10000,
        });
      });

      await test.step('Verify the filter carried over', async () => {
        await expect(
          dashboardPage.getFilterSelectByName('Service'),
        ).toBeVisible({ timeout: 10000 });
      });

      await test.step('Verify the saved query and filter value carried over', async () => {
        await expect(dashboardPage.searchInput).toHaveValue(savedQuery, {
          timeout: 10000,
        });
        await expect(
          dashboardPage
            .getFilterSelectByName('Service')
            .locator('..')
            .getByText('accounting'),
        ).toBeVisible({ timeout: 10000 });
      });
    },
  );
});
