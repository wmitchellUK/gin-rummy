import { cardArtJson, cardArtRouteError } from "@/src/server/card-art-http";
import {
  removeCardArtSlot,
  requireCardArtEditor,
  uploadCardArtSlot,
} from "@/src/server/card-art-service";

type SlotContext = { params: Promise<{ setId: string; slot: string }> };

export async function POST(request: Request, { params }: SlotContext) {
  try {
    await requireCardArtEditor();
    const { setId, slot } = await params;
    const formData = await request.formData().catch(() => null);
    if (!formData) return cardArtJson({ error: { code: "INVALID_IMAGE" } }, 422);
    return cardArtJson(await uploadCardArtSlot(setId, slot, formData));
  } catch (error) { return cardArtRouteError(error); }
}

export async function DELETE(request: Request, { params }: SlotContext) {
  try {
    await requireCardArtEditor();
    const { setId, slot } = await params;
    return cardArtJson(await removeCardArtSlot(
      setId,
      slot,
      await request.json().catch(() => null),
    ));
  } catch (error) { return cardArtRouteError(error); }
}
