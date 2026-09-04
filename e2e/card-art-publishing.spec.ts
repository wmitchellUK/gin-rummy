import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import sharp from "sharp";

const gameConfigured = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL
  && (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
  && (process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY),
);
const FACE_CARD_SLOTS = [
  "J:CLUBS", "J:DIAMONDS", "J:HEARTS", "J:SPADES",
  "Q:CLUBS", "Q:DIAMONDS", "Q:HEARTS", "Q:SPADES",
  "K:CLUBS", "K:DIAMONDS", "K:HEARTS", "K:SPADES",
] as const;

type CardArtSet = {
  id: string;
  draftVersion: number;
  publishedRevision: number;
};

async function firstEnabled(pages: readonly Page[], name: RegExp) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    for (const page of pages) {
      const button = page.getByRole("button", { name });
      if (await button.count() && await button.isEnabled()) return { page, button };
    }
    await pages[0]!.waitForTimeout(200);
  }
  throw new Error(`No enabled button matched ${name}.`);
}

async function uploadRemainingSlots(
  context: BrowserContext,
  set: CardArtSet,
  portrait: Buffer,
): Promise<CardArtSet> {
  let latest = set;
  for (const slot of FACE_CARD_SLOTS.slice(1)) {
    const response = await context.request.post(`/api/card-art/sets/${set.id}/slots/${encodeURIComponent(slot)}`, {
      multipart: {
        image: { name: "known-portrait.png", mimeType: "image/png", buffer: portrait },
        crop: JSON.stringify({ x: 0, y: 0, width: 1, height: 1 }),
        expectedDraftVersion: String(latest.draftVersion),
      },
    });
    expect(response.ok(), `upload ${slot}`).toBeTruthy();
    latest = await response.json() as CardArtSet;
  }
  return latest;
}

async function createAndJoinGame(playerA: Page, playerB: Page) {
  await playerA.goto("/");
  await expect(playerA.getByRole("button", { name: "Create a private game" })).toBeEnabled();
  await playerA.getByRole("button", { name: "Create a private game" }).click();
  await playerA.getByLabel("Your name").fill("Portrait Player A");
  await playerA.getByRole("button", { name: "Continue" }).click();
  await expect(playerA).toHaveURL(/\/game\//);
  const invite = await playerA.locator(".invite-field code").textContent();
  expect(invite).toMatch(/\/join\/[A-Za-z0-9_-]{43}$/);

  await playerB.goto(invite!);
  await playerB.getByLabel("Your name").fill("Portrait Player B");
  await playerB.getByRole("button", { name: "Continue" }).click();
  await playerB.getByRole("button", { name: "Join game" }).click();
  await expect(playerA.getByRole("heading", { name: "Portrait Player A" })).toBeVisible();
  await expect(playerB.getByRole("heading", { name: "Portrait Player B" })).toBeVisible();
}

async function exposeFaceCardOnDiscard(playerA: Page, playerB: Page) {
  const pages = [playerA, playerB] as const;
  const initialLabel = await playerA.locator(".discard-pile").getAttribute("aria-label");
  if (/Take discard [JQK] of /.test(initialLabel ?? "")) return;

  const firstPass = await firstEnabled(pages, /^Pass$/);
  await firstPass.button.click();
  const secondPass = await firstEnabled(pages, /^Pass$/);
  await secondPass.button.click();

  // At most 19 non-face cards can remain in stock when the initial 21 visible/dealt
  // cards contain no face card, so a face card is guaranteed within 20 draws.
  for (let drawNumber = 0; drawNumber < 20; drawNumber += 1) {
    const draw = await firstEnabled(pages, /^Draw stock$/);
    await draw.button.click();
    const drawnCard = draw.page.locator('[data-hand-card][aria-label$=", drawn"]');
    await expect(drawnCard).toBeVisible();
    const label = await drawnCard.getAttribute("aria-label");
    await drawnCard.click();
    await draw.page.getByRole("button", { name: /^Discard / }).click();
    if (/^[JQK] of /.test(label ?? "")) return;
  }
  throw new Error("A face card was not exposed within the deterministic draw bound.");
}

test("publishes one portrait set to both isolated players and resets it live", async ({ browser }) => {
  test.skip(!gameConfigured, "Requires local Supabase browser credentials and a service-role key.");
  test.setTimeout(120_000);

  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  const studio = await contextA.newPage();
  const playerB = await contextB.newPage();
  const setName = `E2E portrait ${Date.now()}`;
  const portrait = await sharp({
    create: { width: 600, height: 900, channels: 3, background: "#c05a3c" },
  }).png().toBuffer();
  let createdSet: CardArtSet | undefined;

  try {
    await contextA.request.post("/api/card-art/default/activate");
    await studio.goto("/card-studio");
    await studio.getByLabel("New set name").fill(setName);
    const createResponsePromise = studio.waitForResponse((response) =>
      response.url().endsWith("/api/card-art/sets") && response.request().method() === "POST",
    );
    await studio.getByRole("button", { name: "Create set" }).click();
    const createResponse = await createResponsePromise;
    expect(createResponse.status()).toBe(201);
    createdSet = await createResponse.json() as CardArtSet;
    await expect(studio.getByRole("heading", { name: setName })).toBeVisible();

    const fileChooserPromise = studio.waitForEvent("filechooser");
    await studio.getByRole("button", { name: "Upload J of clubs artwork" }).click();
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles({ name: "known-portrait.png", mimeType: "image/png", buffer: portrait });
    await expect(studio.getByRole("dialog", { name: "Crop j of clubs" })).toBeVisible();
    const firstUploadResponsePromise = studio.waitForResponse((response) =>
      response.url().includes(`/api/card-art/sets/${createdSet!.id}/slots/J:CLUBS`)
      && response.request().method() === "POST",
    );
    await studio.getByRole("button", { name: "Upload crop" }).click();
    createdSet = await (await firstUploadResponsePromise).json() as CardArtSet;
    createdSet = await uploadRemainingSlots(contextA, createdSet, portrait);

    await studio.reload();
    await studio.getByRole("button", { name: new RegExp(setName) }).click();
    await studio.getByRole("button", { name: "Activate for all games" }).click();
    await expect(studio.getByText(/All open games will update/)).toBeVisible();
    const activateResponsePromise = studio.waitForResponse((response) =>
      response.url().endsWith(`/api/card-art/sets/${createdSet!.id}/activate`),
    );
    await studio.getByRole("button", { name: "Yes, activate globally" }).click();
    expect((await activateResponsePromise).ok()).toBeTruthy();

    await createAndJoinGame(studio, playerB);
    await exposeFaceCardOnDiscard(studio, playerB);

    const portraitA = studio.locator(".discard-pile .court-card-art img");
    const portraitB = playerB.locator(".discard-pile .court-card-art img");
    await expect(portraitA).toBeVisible({ timeout: 7_000 });
    await expect(portraitB).toBeVisible({ timeout: 7_000 });
    expect(await portraitA.getAttribute("src")).toBe(await portraitB.getAttribute("src"));
    await expect(studio.locator(".opponent-hand .card-face")).toHaveCount(0);
    await expect(playerB.locator(".opponent-hand .card-face")).toHaveCount(0);
    await expect(studio.locator(".opponent-hand img")).toHaveCount(0);
    await expect(playerB.locator(".opponent-hand img")).toHaveCount(0);

    const reset = await contextA.request.post("/api/card-art/default/activate");
    expect(reset.ok()).toBeTruthy();
    await expect(portraitA).toHaveCount(0, { timeout: 7_000 });
    await expect(portraitB).toHaveCount(0, { timeout: 7_000 });
    await expect(studio.locator(".discard-pile .court-card")).toBeVisible();
    await expect(playerB.locator(".discard-pile .court-card")).toBeVisible();
  } finally {
    await contextA.request.post("/api/card-art/default/activate").catch(() => undefined);
    if (createdSet) {
      await contextA.request.patch(`/api/card-art/sets/${createdSet.id}`, { data: { archived: true } }).catch(() => undefined);
    }
    await contextA.close();
    await contextB.close();
  }
});
