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

test("a guest starts an immediate recoverable game against Nia", async ({ browser }) => {
  test.skip(!gameConfigured, "Requires Supabase browser credentials and SUPABASE_SECRET_KEY (or legacy SUPABASE_SERVICE_ROLE_KEY).");

  const page = await browser.newPage();
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Play Nia" })).toBeEnabled();
  await page.getByRole("button", { name: "Play Nia" }).click();
  await page.getByLabel("Your name").fill("Solo Player");
  await page.getByRole("button", { name: "Continue" }).click();

  await expect(page).toHaveURL(/\/game\//);
  await expect(page.getByRole("heading", { name: "Nia" })).toBeVisible();
  await expect(page.getByText("Computer opponent", { exact: true })).toBeVisible();
  await expect(page.locator(".invite-field")).toHaveCount(0);
  await expect(page.locator(".bot-avatar img")).toBeVisible();
  await expect(page.locator(".game-actions button:enabled").first()).toBeVisible({ timeout: 10_000 });

  await page.reload();
  await expect(page.getByRole("heading", { name: "Nia" })).toBeVisible();
  await expect(page.getByText("Computer opponent", { exact: true })).toBeVisible();
  await expect(page.locator(".game-actions button:enabled").first()).toBeVisible({ timeout: 10_000 });
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

  const handBeforeDrag = draw.page.locator(".card-hand [data-hand-card]");
  await expect(handBeforeDrag).toHaveCount(10);
  await expect(draw.page.locator(".sort-button")).toHaveCount(0);
  await expect(draw.page.locator(".opponent-area .meld-label")).toHaveCount(0);
  const firstCardName = (await handBeforeDrag.first().getAttribute("aria-label"))!.split(", position")[0]!;
  const firstCardId = (await handBeforeDrag.first().getAttribute("data-card-id"))!;
  const firstBox = await handBeforeDrag.first().boundingBox();
  const lastBox = await handBeforeDrag.last().boundingBox();
  if (!firstBox || !lastBox) throw new Error("Hand cards were not laid out for dragging.");
  // Overlapped hands expose the left rank corner of every card except the final one.
  await draw.page.mouse.move(firstBox.x + 6, firstBox.y + 18);
  await draw.page.mouse.down();
  await draw.page.mouse.move(lastBox.x + lastBox.width / 2, lastBox.y + lastBox.height / 2, { steps: 8 });
  await draw.page.mouse.up();
  await expect(handBeforeDrag.last()).toHaveAttribute("aria-label", new RegExp(`^${firstCardName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}, position 10 of 10`));
  await expect.poll(() => draw.page.evaluate(() => {
    const gameId = location.pathname.split("/").at(-1);
    return (JSON.parse(localStorage.getItem(`gin-rummy:hand-order:v1:${gameId}`) ?? "[]") as string[]).at(-1) ?? null;
  })).toBe(firstCardId);
  await draw.page.reload();
  await expect.poll(() => draw.page.evaluate(() => {
    const gameId = location.pathname.split("/").at(-1);
    return (JSON.parse(localStorage.getItem(`gin-rummy:hand-order:v1:${gameId}`) ?? "[]") as string[]).at(-1) ?? null;
  })).toBe(firstCardId);
  await expect(draw.page.locator(".card-hand [data-hand-card]").last()).toHaveAttribute("aria-label", new RegExp(`^${firstCardName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}, position 10 of 10`));

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

test("a player can discard a different card after accepting the initial up-card", async ({ browser }) => {
  test.skip(!gameConfigured, "Requires Supabase browser credentials and SUPABASE_SECRET_KEY (or legacy SUPABASE_SERVICE_ROLE_KEY).");

  const first = await browser.newPage();
  const second = await browser.newPage();
  await first.goto("/");
  await first.getByRole("button", { name: "Create a private game" }).click();
  await first.getByLabel("Your name").fill("Opening A");
  await first.getByRole("button", { name: "Continue" }).click();
  const invite = await first.locator(".invite-field code").textContent();
  expect(invite).toMatch(/\/join\/[A-Za-z0-9_-]{43}$/);

  await second.goto(invite!);
  await second.getByLabel("Your name").fill("Opening B");
  await second.getByRole("button", { name: "Continue" }).click();
  await second.getByRole("button", { name: "Join game" }).click();

  const openingPlayer = await firstEnabled([first, second], /^Pass$/);
  await openingPlayer.button.click();
  const acceptingPlayer = await firstEnabled([first, second], /^Take discard$/);
  await acceptingPlayer.button.click();
  await expect(acceptingPlayer.page.locator(".action-guidance")).toHaveText("Select a card to discard");

  const legalDiscard = acceptingPlayer.page.locator(".card-hand [data-hand-card]:not(.turn-card-indicated)").first();
  await legalDiscard.click({ position: { x: 10, y: 10 } });
  await acceptingPlayer.page.locator(".game-actions").getByRole("button", { name: /^Discard / }).click();

  const opponent = acceptingPlayer.page === first ? second : first;
  await expect(opponent.getByRole("button", { name: /Draw stock/ })).toBeEnabled();
  await expect(acceptingPlayer.page.locator(".game-error")).toHaveCount(0);
});
