/**
 * A static list filter with "Include "All" option" offers "All" in its
 * dropdown. Picking it stores `all: true` in the `filters=` param and hands
 * tiles every option.
 */
import { DashboardPage } from '../page-objects/DashboardPage';
import { expect, test } from '../utils/base-test';
import { expectFiltersParam } from '../utils/filters-param';

const ENVIRONMENTS = ['prod', 'staging', 'dev'];
const ALL_ENTRY = {
  type: 'variable' as const,
  name: 'env',
  values: [],
  all: true as const,
};

test.describe(
  'Dashboard filter "All" option',
  { tag: ['@dashboard', '@full-stack'] },
  () => {
    let dashboardPage: DashboardPage;

    test.beforeEach(async ({ page }) => {
      dashboardPage = new DashboardPage(page);
      await dashboardPage.goto();
      await dashboardPage.createNewDashboard();
      await dashboardPage.addMarkdownTile('Envs', 'Environments: $env');
      await dashboardPage.openEditFiltersModal();
      await dashboardPage.addStaticListFilterToDashboard(
        'Environment',
        ENVIRONMENTS,
        { variableName: 'env', allowAll: true },
      );
      await dashboardPage.closeFiltersModal();
    });

    test('selects every option for tiles', async ({ page }) => {
      await dashboardPage.openFilterDropdown('Environment');
      await dashboardPage.getFilterOption('All').click();

      await expect(
        dashboardPage.getFilterPill('Environment', 'All'),
      ).toBeVisible();
      await expectFiltersParam(page, [ALL_ENTRY]);
      await expect(dashboardPage.getTile(0)).toContainText(
        'Environments: dev, prod, staging',
      );
    });

    test('replaces "All" with a value picked after it', async ({ page }) => {
      await dashboardPage.openFilterDropdown('Environment');
      await dashboardPage.getFilterOption('All').click();
      await expectFiltersParam(page, [ALL_ENTRY]);

      await dashboardPage.openFilterDropdown('Environment');
      await dashboardPage.getFilterOption('prod').click();

      await expect(
        dashboardPage.getFilterPill('Environment', 'prod'),
      ).toBeVisible();
      await expect(
        dashboardPage.getFilterPill('Environment', 'All'),
      ).toHaveCount(0);
      await expectFiltersParam(page, [
        { type: 'variable', name: 'env', values: ['prod'] },
      ]);
    });
  },
);
