import type { Page } from '@playwright/test';

import { expect, test } from '../utils/base-test';

/**
 * iPhone 12 Safari: 390x745 with the browser toolbar retracted, 390x664 with
 * it on screen. The viewport below is the large one, because that is what
 * `100vh` resolves to; the toolbar covers the bottom of it.
 */
const LARGE_VIEWPORT = { width: 390, height: 745 };

// Playwright has no toolbar emulation, so Chromium's own override stands in for
// one: it makes `svh` smaller than `lvh` the way a phone with its toolbar on
// screen does. The value is not in CSS pixels, only "large enough that the two
// units differ", which the test asserts before relying on it.
const SMALL_VIEWPORT_DIFFERENCE = 200;

async function measureViewportHeights(page: Page) {
  return page.evaluate(() => {
    const measure = (unit: string) => {
      const probe = document.createElement('div');
      probe.style.cssText = `position:fixed;top:0;width:0;height:100${unit}`;
      document.body.appendChild(probe);
      const height = probe.getBoundingClientRect().height;
      probe.remove();
      return height;
    };
    return { small: measure('svh'), large: measure('lvh') };
  });
}

async function expectUserMenuOnScreen(page: Page, smallViewportHeight: number) {
  const userMenu = page.locator('[data-testid="user-menu-trigger"]');
  await expect(userMenu).toBeVisible();
  await expect
    .poll(async () => {
      const box = await userMenu.boundingBox();
      return box ? box.y + box.height : Number.POSITIVE_INFINITY;
    })
    .toBeLessThanOrEqual(smallViewportHeight);
}

test.describe('Mobile app nav', { tag: ['@core'] }, () => {
  test.use({ viewport: LARGE_VIEWPORT, isMobile: true, hasTouch: true });

  test('keeps the user menu on screen behind a browser toolbar', async ({
    page,
  }) => {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setSmallViewportHeightDifferenceOverride', {
      difference: SMALL_VIEWPORT_DIFFERENCE,
    });

    await page.goto('/search');
    await expect(page.locator('[data-testid="app-nav"]')).toBeVisible();

    const viewport = await measureViewportHeights(page);
    // Without this the test would pass vacuously on a browser that ignores the
    // override, since every viewport unit would resolve to the same height.
    expect(viewport.small).toBeLessThan(viewport.large);

    await test.step('collapsed rail', async () => {
      await expectUserMenuOnScreen(page, viewport.small);
    });

    await test.step('expanded overlay', async () => {
      await page
        .locator('button[aria-label="Collapse/expand navigation"]')
        .click();
      await expectUserMenuOnScreen(page, viewport.small);
    });
  });
});
