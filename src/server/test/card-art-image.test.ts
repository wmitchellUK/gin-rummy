import { describe, expect, it } from "vitest";
import sharp from "sharp";
import {
  MAX_CARD_ART_UPLOAD_BYTES,
  parseNormalizedCrop,
  processCardArtImage,
} from "../card-art-image";

async function expectCode(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toMatchObject({ code });
}

describe("card-art image processing", () => {
  it.each(["jpeg", "png", "webp"] as const)("decodes %s input", async (format) => {
    const pipeline = sharp({
      create: { width: 400, height: 600, channels: 3, background: "#b84737" },
    });
    const input = await pipeline[format]().toBuffer();

    const output = await processCardArtImage(input, { x: 0, y: 0, width: 1, height: 1 });

    await expect(sharp(output).metadata()).resolves.toMatchObject({
      format: "webp",
      width: 600,
      height: 900,
    });
  });

  it("normalizes EXIF orientation, crops, and emits metadata-free 600x900 WebP", async () => {
    const input = await sharp({
      create: { width: 1200, height: 800, channels: 3, background: "#c0392b" },
    }).jpeg().withMetadata({ orientation: 6 }).toBuffer();

    const output = await processCardArtImage(input, { x: 0, y: 0, width: 1, height: 1 });
    const metadata = await sharp(output).metadata();

    expect(metadata).toMatchObject({ format: "webp", width: 600, height: 900 });
    expect(metadata.exif).toBeUndefined();
    expect(metadata.icc).toBeUndefined();
    expect(metadata.orientation).toBeUndefined();
  });

  it("preserves a transparent portrait background in the WebP derivative", async () => {
    const subject = await sharp({
      create: { width: 160, height: 360, channels: 4, background: { r: 210, g: 170, b: 130, alpha: 1 } },
    }).png().toBuffer();
    const input = await sharp({
      create: { width: 400, height: 600, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    }).composite([{ input: subject, left: 120, top: 120 }]).png().toBuffer();

    const output = await processCardArtImage(input, { x: 0, y: 0, width: 1, height: 1 });
    const metadata = await sharp(output).metadata();
    const { data, info } = await sharp(output).raw().toBuffer({ resolveWithObject: true });
    const alphaAt = (x: number, y: number) => data[(y * info.width + x) * info.channels + 3];

    expect(metadata).toMatchObject({ format: "webp", width: 600, height: 900, hasAlpha: true });
    expect(info.channels).toBe(4);
    expect(alphaAt(10, 10)).toBe(0);
    expect(alphaAt(300, 450)).toBe(255);
  });

  it("rejects crops outside the oriented image or with a non-2:3 pixel aspect", async () => {
    const input = await sharp({
      create: { width: 800, height: 1200, channels: 3, background: "#123456" },
    }).png().toBuffer();

    await expectCode(processCardArtImage(input, { x: 0.2, y: 0, width: 0.9, height: 1 }), "INVALID_CROP");
    await expectCode(processCardArtImage(input, { x: 0, y: 0, width: 0.5, height: 1 }), "INVALID_CROP");
    expect(() => parseNormalizedCrop("not json")).toThrowError(expect.objectContaining({ code: "INVALID_CROP" }));
  });

  it("extracts the requested crop before resizing", async () => {
    const input = await sharp({
      create: { width: 600, height: 1200, channels: 3, background: "#1654a3" },
    }).composite([{
      input: await sharp({
        create: { width: 600, height: 900, channels: 3, background: "#d93f32" },
      }).png().toBuffer(),
      top: 0,
      left: 0,
    }]).png().toBuffer();

    const output = await processCardArtImage(input, { x: 0, y: 0, width: 1, height: 0.75 });
    const { data, info } = await sharp(output).raw().toBuffer({ resolveWithObject: true });
    const bottomCenter = ((info.height - 1) * info.width + Math.floor(info.width / 2)) * info.channels;

    expect(data[bottomCenter]).toBeGreaterThan(180);
    expect(data[bottomCenter + 2]).toBeLessThan(100);
  });

  it("distinguishes oversized, unsupported, SVG, and malformed inputs", async () => {
    await expectCode(
      processCardArtImage(Buffer.alloc(MAX_CARD_ART_UPLOAD_BYTES + 1), { x: 0, y: 0, width: 1, height: 1 }),
      "IMAGE_TOO_LARGE",
    );
    const gif = await sharp({
      create: { width: 200, height: 300, channels: 3, background: "white" },
    }).gif().toBuffer();
    await expectCode(processCardArtImage(gif, { x: 0, y: 0, width: 1, height: 1 }), "UNSUPPORTED_IMAGE_TYPE");
    await expectCode(
      processCardArtImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="2" height="3"/>'), { x: 0, y: 0, width: 1, height: 1 }),
      "UNSUPPORTED_IMAGE_TYPE",
    );
    await expectCode(processCardArtImage(Buffer.from("not an image"), { x: 0, y: 0, width: 1, height: 1 }), "INVALID_IMAGE");
  });

  it("enforces the 40-megapixel decoder ceiling", async () => {
    const tooManyPixels = await sharp({
      create: { width: 8_000, height: 5_001, channels: 3, background: "white" },
    }).png({ compressionLevel: 9 }).toBuffer();

    await expectCode(
      processCardArtImage(tooManyPixels, { x: 0, y: 0, width: 1, height: 1 }),
      "INVALID_IMAGE",
    );
  });
});
