import "server-only";

import { HttpError } from "./auth";

export const CARD_ART_ERROR_STATUS = {
  INVALID_SLOT: 400,
  INVALID_SET_NAME: 400,
  IMAGE_TOO_LARGE: 413,
  UNSUPPORTED_IMAGE_TYPE: 415,
  INVALID_IMAGE: 422,
  INVALID_CROP: 422,
  SET_NOT_FOUND: 404,
  SET_ARCHIVED: 409,
  ACTIVE_SET_ARCHIVE: 409,
  DRAFT_CONFLICT: 409,
  ACTIVATION_CONFLICT: 409,
} as const;

export type CardArtErrorCode = keyof typeof CARD_ART_ERROR_STATUS;

export function cardArtError(code: CardArtErrorCode): HttpError {
  return new HttpError(CARD_ART_ERROR_STATUS[code], code);
}
