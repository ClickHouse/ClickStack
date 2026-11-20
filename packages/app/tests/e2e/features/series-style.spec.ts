import { DashboardPage } from '../page-objects/DashboardPage';
import { expect, test } from '../utils/base-test';

test.describe('Series style', { tag: ['@dashboard'] }, () => {
  test('draws a line series in its color and line style and round-trips into the editor', async ({
    page,
  }) => {
    const dashboardPage = new DashboardPage(page);
    const editor = dashboardPage.chartEditor;
    const curve = dashboardPage
      .getTiles()
      .first()
      .locator('.recharts-area-curve')
      .first();

    await test.step('Style the series of a new line tile', async () => {
      await dashboardPage.goto();
      await dashboardPage.createNewDashboard();
      await dashboardPage.addTile();
      await expect(editor.nameInput).toBeVisible();
      await editor.waitForDataToLoad();
      await editor.setChartName(`Series style tile ${Date.now()}`);
      await editor.setSeriesStyle(0, {
        color: 'chart-purple',
        lineStyle: 'Dotted',
      });
      await editor.save();
      await expect(dashboardPage.getTiles()).toHaveCount(1, {
        timeout: 10000,
      });
    });

    await test.step('The line is drawn purple and dotted', async () => {
      await expect(curve).toHaveAttribute('stroke', '#a463f2', {
        timeout: 30000,
      });
      await expect(curve).toHaveAttribute('stroke-dasharray', '1.5 3');
    });

    await test.step('The style round-trips into the editor', async () => {
      await dashboardPage.editTile(0);
      await expect(editor.nameInput).toBeVisible();
      await editor.openSeriesStyle(0);
      await expect(editor.seriesLineStyleOption('Dotted')).toBeChecked();
    });
  });

  test('hides the series style control once the chart is grouped', async ({
    page,
  }) => {
    const dashboardPage = new DashboardPage(page);
    const editor = dashboardPage.chartEditor;

    await dashboardPage.goto();
    await dashboardPage.createNewDashboard();
    await dashboardPage.addTile();
    await expect(editor.nameInput).toBeVisible();
    await editor.waitForDataToLoad();
    await expect(editor.seriesStyleButton(0)).toBeVisible();

    await editor.setGroupBy('ServiceName');
    await expect(editor.seriesStyleButton(0)).toBeHidden();
  });
});
