import { expect, test, type Page } from "@playwright/test";

const authConfigured = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY));
const gameConfigured = authConfigured && Boolean(process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY);

async function firstEnabled(pages: readonly Page[], name: RegExp) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    for (const page of pages) {
      const button = page.getByRole("button", { name });
      if (await button.count() && await button.isEnabled()) return { page, button };
    }
    await pages[0]!.waitForTimeout(200);
  }
  throw new Error(`No enabled button matched ${name}.`);
}

test("anonymous browser sessions reach route handlers through auth cookies", async ({ browser }) => {
  test.skip(!authConfigured, "Requires Supabase browser credentials.");

  const a = await browser.newPage();
  const b = await browser.newPage();
  await a.goto("/");
  await b.goto("/");
  await expect(a.getByRole("button", { name: "Create a private game" })).toBeEnabled();
  await expect(b.getByRole("button", { name: "Create a private game" })).toBeEnabled();
  expect((await a.context().cookies()).some(({ name }) => name.includes("auth-token"))).toBeTruthy();
  expect((await b.context().cookies()).some(({ name }) => name.includes("auth-token"))).toBeTruthy();

  const sessionFor = async (page: Page) => page.evaluate(async () => {
    const response = await fetch("/api/session/anonymous", { method: "POST", credentials: "same-origin" });
    const body = await response.json() as { userId?: unknown };
    return { status: response.status, userId: typeof body.userId === "string" ? body.userId : null };
  });
  const [aSession, bSession] = await Promise.all([sessionFor(a), sessionFor(b)]);
  expect(aSession.status).toBe(200);
  expect(bSession.status).toBe(200);
  expect(aSession.userId).toBeTruthy();
  expect(bSession.userId).toBeTruthy();
  expect(aSession.userId).not.toBe(bSession.userId);

  const unauthenticated = await browser.newContext();
  expect((await unauthenticated.request.post("/api/games")).status()).toBe(401);
  await unauthenticated.close();
});

test("two anonymous browsers create, join, synchronize an action, and recover after refresh", async ({ browser }) => {
  test.skip(!gameConfigured, "Requires Supabase browser credentials and SUPABASE_SECRET_KEY (or legacy SUPABASE_SERVICE_ROLE_KEY).");

  const a = await browser.newPage();
  const b = await browser.newPage();
  await a.goto("/");
  await expect(a.getByRole("button", { name: "Create a private game" })).toBeEnabled();
  expect((await a.context().cookies()).some(({ name }) => name.includes("auth-token"))).toBeTruthy();
  await a.getByRole("button", { name: "Create a private game" }).click();
  await a.getByLabel("Your name").fill("Player A");
  await a.getByRole("button", { name: "Continue" }).click();
  await expect(a).toHaveURL(/\/game\//);
  const invite = await a.locator(".invite-field code").textContent();
  expect(invite).toMatch(/\/join\/[A-Za-z0-9_-]{43}$/);

  await b.goto(invite!);
  await expect(b.getByLabel("Your name")).toBeVisible();
  expect((await b.context().cookies()).some(({ name }) => name.includes("auth-token"))).toBeTruthy();
  await b.getByLabel("Your name").fill("Player B");
  await b.getByRole("button", { name: "Continue" }).click();
  await b.getByRole("button", { name: "Join game" }).click();
  await expect(a.getByRole("heading", { name: "Player A" })).toBeVisible();
  await expect(b.getByRole("heading", { name: "Player B" })).toBeVisible();
  await Promise.all([a.setViewportSize({ width: 390, height: 844 }), b.setViewportSize({ width: 390, height: 844 })]);

  // Dealer is deliberately random, so drive the real server-selected active player.
  const firstPass = await firstEnabled([a, b], /^Pass$/);
  expect(await firstPass.page.locator(".game-actions").evaluate((element) => getComputedStyle(element).position)).toBe("sticky");
  await expect(firstPass.page.locator(".game-actions button")).toHaveCount(2);
  await firstPass.button.click();
  const secondPass = await firstEnabled([a, b], /^Pass$/);
  await secondPass.button.click();
  const draw = await firstEnabled([a, b], /Draw stock/);
  await draw.button.click();
  await expect(draw.page.locator(".action-guidance")).toHaveText("Select a card to discard");
  const handCard = draw.page.locator(".card-hand [data-hand-card]").first();
  await handCard.click({ position: { x: 10, y: 10 } });
  await draw.page.getByRole("button", { name: /^Discard / }).click();

  const other = draw.page === a ? b : a;
  await expect(other.getByRole("button", { name: /Draw stock/ })).toBeEnabled();
  await other.reload();
  await expect(other.getByRole("heading", { name: other === a ? "Player A" : "Player B" })).toBeVisible();
  await expect(other.getByRole("button", { name: /Draw stock/ })).toBeEnabled();
});
