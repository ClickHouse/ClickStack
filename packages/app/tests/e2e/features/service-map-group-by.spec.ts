import { Page } from '@playwright/test';

import { expect, test } from '../utils/base-test';
import { dismissSqlAutocomplete, replaceEditorText } from '../utils/locators';

// The seed gives every service two pods, `<service>-pod-0` and
// `<service>-pod-1`, in ResourceAttributes['k8s.pod.name'].
const POD_EXPRESSION = "ResourceAttributes['k8s.pod.name']";

// 100% sampling: the default 10% can sample the small seed down to nothing.
async function gotoServiceMap(page: Page, query = '') {
  await page.goto(`/service-map?samplingFactor=1${query}`);
  await expect(page.getByTestId('service-map-page')).toBeVisible({
    timeout: 30000,
  });
  await expect(page.locator('.react-flow__node').first()).toBeVisible({
    timeout: 30000,
  });
}

const nodes = (page: Page) => page.locator('.react-flow__node');
const dimensionLabels = (page: Page) =>
  page.getByTestId('service-map-node-dimensions');

// Typing opens the SQL autocomplete, which would swallow the Enter that
// submits the form, so close it and refocus the editor before submitting.
async function setGroupBy(page: Page, sql: string) {
  const content = page
    .getByTestId('service-map-group-by-input')
    .locator('.cm-content');
  await replaceEditorText(page, content, sql);
  await dismissSqlAutocomplete(page);
  await content.click();
  await page.keyboard.press('Enter');
}

test.describe('Service map group by', { tag: ['@service-map'] }, () => {
  test('splits nodes by an extra dimension from the URL', async ({ page }) => {
    test.setTimeout(120000);

    await gotoServiceMap(page);
    const serviceNodeCount = await nodes(page).count();
    await expect(dimensionLabels(page)).toHaveCount(0);

    await gotoServiceMap(
      page,
      `&groupBy=${encodeURIComponent(POD_EXPRESSION)}`,
    );
    await expect
      .poll(() => nodes(page).count(), { timeout: 30000 })
      .toBeGreaterThan(serviceNodeCount);
    const labels = await dimensionLabels(page).allTextContents();
    expect(labels.length).toBeGreaterThan(0);
    expect(labels.some(label => label.includes('-pod-'))).toBe(true);
  });

  test('applies the editor on Enter and caps it at three expressions', async ({
    page,
  }) => {
    test.setTimeout(120000);

    await gotoServiceMap(page);

    await setGroupBy(page, POD_EXPRESSION);
    await expect(page).toHaveURL(/groupBy=/, { timeout: 10000 });
    await expect(dimensionLabels(page).first()).toBeVisible({ timeout: 30000 });

    const urlBefore = page.url();
    await setGroupBy(page, 'a, b, c, d');
    await expect(page.getByTestId('service-map-group-by-error')).toHaveText(
      'Up to 3 group by expressions',
    );
    expect(page.url()).toBe(urlBefore);
  });
});
