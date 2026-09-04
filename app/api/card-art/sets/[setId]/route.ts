import { cardArtJson, cardArtRouteError } from "@/src/server/card-art-http";
import { requireCardArtEditor, updateCardArtSet } from "@/src/server/card-art-service";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ setId: string }> },
) {
  try {
    await requireCardArtEditor();
    const { setId } = await params;
    return cardArtJson(await updateCardArtSet(setId, await request.json().catch(() => null)));
  } catch (error) { return cardArtRouteError(error); }
}
