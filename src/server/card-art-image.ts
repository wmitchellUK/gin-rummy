import "server-only";

import sharp, { type Metadata } from "sharp";
import { cardArtError } from "./card-art-errors";

export const MAX_CARD_ART_UPLOAD_BYTES = 10 * 1024 * 1024;
export const MAX_CARD_ART_INPUT_PIXELS = 40_000_000;

export interface NormalizedCrop {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

const ALLOWED_FORMATS = new Set(["jpeg", "png", "webp"]);

function looksLikeSvg(contents: Buffer): boolean {
  const prefix = contents.subarray(0, 4096).toString("utf8").replace(/^\uFEFF/, "").trimStart();
  return /^<svg\b/i.test(prefix)
    || /^<\?xml[\s\S]*?<svg\b/i.test(prefix)
    || /^<!doctype\s+svg\b/i.test(prefix);
}

export function parseNormalizedCrop(value: unknown): NormalizedCrop {
  let parsed = value;
  if (typeof value === "string") {
    try { parsed = JSON.parse(value); }
    catch { throw cardArtError("INVALID_CROP"); }
  }
  if (!parsed || typeof parsed !== "object") throw cardArtError("INVALID_CROP");
  const candidate = parsed as Record<string, unknown>;
  const crop = {
    x: candidate.x,
    y: candidate.y,
    width: candidate.width,
    height: candidate.height,
  };
  if (!Object.values(crop).every((number) => typeof number === "number" && Number.isFinite(number))) {
    throw cardArtError("INVALID_CROP");
  }
  return crop as NormalizedCrop;
}

function cropPixels(crop: NormalizedCrop, imageWidth: number, imageHeight: number) {
  if (
    crop.x < 0 || crop.y < 0 || crop.width <= 0 || crop.height <= 0
    || crop.x + crop.width > 1 + Number.EPSILON
    || crop.y + crop.height > 1 + Number.EPSILON
  ) throw cardArtError("INVALID_CROP");

  const pixelAspect = (crop.width * imageWidth) / (crop.height * imageHeight);
  if (Math.abs(pixelAspect - 2 / 3) > 0.002) throw cardArtError("INVALID_CROP");

  const left = Math.round(crop.x * imageWidth);
  const top = Math.round(crop.y * imageHeight);
  const right = Math.round((crop.x + crop.width) * imageWidth);
  const bottom = Math.round((crop.y + crop.height) * imageHeight);
  const width = right - left;
  const height = bottom - top;
  if (width < 1 || height < 1 || left < 0 || top < 0 || right > imageWidth || bottom > imageHeight) {
    throw cardArtError("INVALID_CROP");
  }
  return { left, top, width, height };
}

export async function processCardArtImage(
  contents: Buffer,
  crop: NormalizedCrop,
): Promise<Buffer> {
  if (contents.byteLength > MAX_CARD_ART_UPLOAD_BYTES) throw cardArtError("IMAGE_TOO_LARGE");
  if (looksLikeSvg(contents)) throw cardArtError("UNSUPPORTED_IMAGE_TYPE");

  let metadata: Metadata;
  try {
    metadata = await sharp(contents, { limitInputPixels: MAX_CARD_ART_INPUT_PIXELS, failOn: "error" }).metadata();
  } catch {
    throw cardArtError("INVALID_IMAGE");
  }
  if (!ALLOWED_FORMATS.has(metadata.format)) throw cardArtError("UNSUPPORTED_IMAGE_TYPE");

  const width = metadata.autoOrient.width;
  const height = metadata.autoOrient.height;
  if (!width || !height || width * height > MAX_CARD_ART_INPUT_PIXELS) throw cardArtError("INVALID_IMAGE");
  const extraction = cropPixels(crop, width, height);

  try {
    return await sharp(contents, { limitInputPixels: MAX_CARD_ART_INPUT_PIXELS, failOn: "error" })
      .autoOrient()
      .extract(extraction)
      .resize(600, 900, { fit: "fill" })
      .webp({ quality: 85, alphaQuality: 100 })
      .toBuffer();
  } catch {
    throw cardArtError("INVALID_IMAGE");
  }
}
