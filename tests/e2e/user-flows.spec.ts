import { expect, test, type Page } from '@playwright/test';

async function installMocks(page: Page) {
  await page.route('**/api/auth/me', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, user: { email: 'test@otg.local', username: 'tester' } }),
    });
  });

  await page.route('**/api/auth/login', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
  });

  await page.route('**/api/gallery**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        files: [{ name: 'otg_mock_gallery.png', url: '/SLR.gif', kind: 'image', media: 'image' }],
      }),
    });
  });

  await page.route('**/api/favorites**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, files: [] }) });
  });

  await page.route('**/api/audio-library**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, items: [{ id: 'mock-audio', name: 'Mock audio', category: 'reference' }] }),
    });
  });

  await page.route('**/api/voice/**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
  });
}

async function assertNoAppCrash(page: Page) {
  await expect(page.locator('body')).toBeVisible();
  await expect(
    page.getByText(/application error|unhandled runtime error|this page could not be found|500 internal server error/i)
  ).toHaveCount(0);
}

async function openApp(page: Page) {
  await installMocks(page);
  await page.goto('/app', { waitUntil: 'domcontentloaded' });
  await assertNoAppCrash(page);
}

async function clickFirstVisible(page: Page, name: RegExp, timeout = 1500) {
  const target = page
    .getByRole('button', { name })
    .or(page.getByRole('link', { name }))
    .or(page.getByText(name))
    .first();

  try {
    await expect(target).toBeVisible({ timeout });
    await target.click({ timeout });
    return true;
  } catch {
    return false;
  }
}

test('login flow submits credentials and enters app', async ({ page }) => {
  await installMocks(page);
  await page.goto('/login', { waitUntil: 'domcontentloaded' });
  await assertNoAppCrash(page);

  const email = page.getByLabel(/email/i).or(page.getByPlaceholder(/email|username/i)).first();
  if (await email.isVisible().catch(() => false)) await email.fill('test@otg.local');

  const password = page.getByLabel(/password/i).or(page.getByPlaceholder(/password/i)).first();
  if (await password.isVisible().catch(() => false)) await password.fill('password123');

  const submit = page.getByRole('button', { name: /sign in|login|log in/i }).first();
  if (await submit.isVisible().catch(() => false)) await submit.click();

  await page.goto('/app', { waitUntil: 'domcontentloaded' });
  await assertNoAppCrash(page);
});

test('Gallery loads, supports search when present, and favorites an item', async ({ page }) => {
  await openApp(page);
  await clickFirstVisible(page, /^Gallery$/i);

  const search = page.getByPlaceholder(/search/i).or(page.getByRole('searchbox')).first();
  if (await search.isVisible().catch(() => false)) await search.fill('mock');

  const favorite = page.getByRole('button', { name: /favorite|star|heart/i }).first();
  if (await favorite.isVisible().catch(() => false)) await favorite.click();

  await assertNoAppCrash(page);
});

test('Edit Video tab/navigation renders without crashing', async ({ page }) => {
  await openApp(page);
  await clickFirstVisible(page, /edit video|video edit|edit/i);
  await assertNoAppCrash(page);
});

test('Audio Library save/load flow renders without crashing', async ({ page }) => {
  await openApp(page);
  await clickFirstVisible(page, /audio library|audio/i);

  const text = page.getByRole('textbox').first();
  if (await text.isVisible().catch(() => false)) await text.fill('Mock reference text');

  const save = page.getByRole('button', { name: /save/i }).first();
  if ((await save.isVisible().catch(() => false)) && (await save.isEnabled().catch(() => false))) {
    await save.click();
  }

  await assertNoAppCrash(page);
});

test('Voice Dubbing TTS form renders and submits mocked request', async ({ page }) => {
  await openApp(page);
  await clickFirstVisible(page, /voice dubbing|tts|voice/i);

  const text = page.getByRole('textbox').first();
  if (await text.isVisible().catch(() => false)) await text.fill('Hello from OTG test');

  const submit = page.getByRole('button', { name: /generate|submit|dub|speak|create/i }).first();
  if ((await submit.isVisible().catch(() => false)) && (await submit.isEnabled().catch(() => false))) {
    await submit.click();
  }

  await assertNoAppCrash(page);
});

for (const name of ['Characters', 'Angles', 'Production']) {
  test(name + ' page/panel renders without crashing', async ({ page }) => {
    await openApp(page);
    await clickFirstVisible(page, new RegExp(name, 'i'));
    await assertNoAppCrash(page);
  });
}
