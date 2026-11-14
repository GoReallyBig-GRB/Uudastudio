import { expect, test } from '@playwright/test';

const jobId = '0123456789abcdef0123456789abcdef';
const talentKey = 'abcdef0123456789abcdef0123456789';
const dailyLimit = 'The service has reached its daily limit. Your recording is safe on this device. Try again after 00:00 UTC, or save the file and send it yourself.';

for (const scenario of [
  { status: 429, message: dailyLimit },
  { status: 507, message: 'Storage is full. Your recording is safe on this device. Save the file and send it yourself.' },
]) {
  test(`keeps the take savable when upload returns HTTP ${scenario.status}`, async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('uuda-guest-mic-seen', '1'));
    await page.route('**/api/jobs/**', async (route) => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      if (path.endsWith('/thread') && request.method() === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            role: 'talent',
            job: {
              title: 'Playwright upload check',
              script: 'A short line for the test recording.',
              notes: '',
              producer: 'Test producer',
              talent: 'Test voice',
              targetSeconds: 20,
              createdAt: Date.now(),
              reference: null,
            },
            messages: [],
            lastId: 0,
          }),
        });
        return;
      }
      if (path.endsWith('/uploads') && request.method() === 'POST') {
        await route.fulfill({
          status: scenario.status,
          contentType: 'application/json',
          body: JSON.stringify({ error: scenario.status === 507 ? 'Storage is full.' : 'Request cap reached.' }),
        });
        return;
      }
      await route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: 'Unexpected test request.' }) });
    });

    await page.goto(`/#/t/${jobId}.${talentKey}`);
    await expect(page.getByText('A short line for the test recording.')).toBeVisible();
    await page.getByRole('button', { name: 'Record', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Stop recording' })).toBeVisible();
    await expect(page.getByLabel('Time recorded').first()).not.toHaveText('0:00', { timeout: 10_000 });
    await page.getByRole('button', { name: 'Stop recording' }).click();
    await page.getByRole('button', { name: 'Tap again to stop' }).click();

    await expect(page.getByText('Your take', { exact: true })).toBeVisible({ timeout: 10_000 });
    await page.getByRole('button', { name: 'Send to producer' }).click();

    await expect(page.getByRole('alert').filter({ hasText: scenario.message })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('Your take', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save WAV' })).toBeVisible();
    await expect(page.getByText(/Sent\. The producer can hear it now/)).toHaveCount(0);
  });
}
