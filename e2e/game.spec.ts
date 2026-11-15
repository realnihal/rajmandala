import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

const FULL_MAP = '0 0 1000 1141';
const count = (label: string | null) => Number(label?.match(/: (\d+) armies/)?.[1] ?? 0);

/** Clicks the current player's strongest territory, then the weakest enemy next to it. */
async function pickAttack(page: Page, me: string) {
  const tokens = page.locator('.token.clickable');
  const labels = await tokens.evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')));
  const mine = labels.map((l, i) => ({ l, i })).filter((x) => x.l?.endsWith(`, ${me}`)).sort((a, b) => count(b.l) - count(a.l));
  await tokens.nth(mine[0].i).locator('.disc').click();
  const after = await page.locator('.token.clickable').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')));
  const target = after.findIndex((l) => !l?.endsWith(`, ${me}`));
  await page.locator('.token.clickable').nth(target).locator('.disc').click();
}

test('shared screen: an attack zooms in, rolls dice and shows the result', async ({ page }) => {
  await page.goto('/#/local');
  await page.getByRole('button', { name: 'Start game' }).click();
  for (let i = 1; i <= 3; i++) {
    await expect(page.locator('.controls')).toContainText(`Capital ${i} of 3`);
    await page.getByRole('button', { name: 'Choose at random' }).click();
  }
  await expect(page.locator('.controls')).toContainText('Place armies');

  const me = (await page.locator('.turn h1').textContent())!;
  await page.locator('.token.clickable .disc').first().click();
  await page.getByRole('button', { name: /^Place all/ }).click();
  await page.getByRole('button', { name: 'Go to attack' }).click();
  await expect(page.locator('.controls')).toContainText('Click one of your territories');
  await pickAttack(page, me);
  await page.getByRole('button', { name: /^Roll \d$/ }).last().click();

  // The battle plays out: dice tumble and the map zooms to the fight.
  await expect(page.locator('.die.rolling').first()).toBeVisible();
  await expect(page.locator('.clash')).toBeVisible();
  await expect(page.locator('.board')).not.toHaveAttribute('viewBox', FULL_MAP);
  // Then it settles, reports the losses and zooms back out.
  await expect(page.locator('.dice p')).toContainText(/attacker lost \d, defender lost \d/, { timeout: 10_000 });
  await expect(page.locator('.die.rolling')).toHaveCount(0);
  await expect(page.locator('.board')).toHaveAttribute('viewBox', FULL_MAP, { timeout: 10_000 });
});

test('online: a room with computer players starts and the bots take their turns', async ({ page }) => {
  await page.goto('/');
  await page.getByPlaceholder('e.g. Asha').fill('Tester');
  await page.getByRole('button', { name: 'Create a room' }).click();
  await expect(page.getByRole('heading', { name: /^Room [A-Z0-9]{6}$/ })).toBeVisible();
  await expect(page.getByLabel('Invite link')).toHaveValue(/#\/r\/[A-Z0-9]{6}$/);

  await page.getByRole('button', { name: 'Add a computer player' }).click();
  await page.getByRole('button', { name: 'Add a computer player' }).click();
  await expect(page.locator('.seats li .badge', { hasText: 'Computer' })).toHaveCount(2);
  await page.getByRole('button', { name: 'Start game' }).click();
  await page.getByRole('button', { name: 'Choose at random' }).click();

  // Everyone has a capital, the game is under way, and the log fills as turns are played.
  await expect(page.locator('.tower')).toHaveCount(3);
  await expect(page.locator('.turn .meta')).toContainText('Round 1');
  await expect(page.locator('.log li').first()).toBeVisible();
  // Bots move by themselves (slowly, so people can follow): either it is already this
  // player's turn, or the log keeps growing as the bots play.
  await expect
    .poll(async () => (await page.title()).includes('Your turn') || (await page.locator('.log li').count()) >= 5, { timeout: 40_000 })
    .toBe(true);
});
