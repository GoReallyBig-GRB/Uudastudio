import { expect, test } from '@playwright/test';

const jobId = '0123456789abcdef0123456789abcdef';
const talentKey = 'abcdef0123456789abcdef0123456789';
const dailyLimit = 'The service has reached its daily limit. Your recording is safe on this device. Try again after 00:00 UTC, or save the file and send it yourself.';
const storageFull = 'The service has no room for more audio right now. Your recording is safe on this device. Save the file and send it yourself, or try again later.';

// What the guest sees when the upload is refused. `body` is what the server (or Cloudflare) answers with.
// A 429 with no message of ours is Cloudflare's own daily cap; a 429 with our own message is a different limit
// (for example a full thread) and must not claim the daily cap is reached.
for (const scenario of [
  { status: 429, contentType: 'text/plain', body: 'Too Many Requests', message: dailyLimit, notMessage: null },
  { status: 507, contentType: 'application/json', body: JSON.stringify({ error: storageFull }), message: storageFull, notMessage: null },
  { status: 429, contentType: 'application/json', body: JSON.stringify({ error: 'This conversation is full.' }), message: 'This conversation is full.', notMessage: 'daily limit' },
]) {
  test(`keeps the take savable when upload returns HTTP ${scenario.status} (${scenario.message.slice(0, 24)}...)`, async ({ page }) => {
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
          contentType: scenario.contentType,
          body: scenario.body,
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
    if (scenario.notMessage) await expect(page.getByRole('alert').filter({ hasText: scenario.notMessage })).toHaveCount(0);
    await expect(page.getByText('Your take', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save WAV' })).toBeVisible();
    await expect(page.getByText(/Sent\. The producer can hear it now/)).toHaveCount(0);
  });
}
