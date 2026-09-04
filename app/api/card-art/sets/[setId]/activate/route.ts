import { cardArtJson, cardArtRouteError } from "@/src/server/card-art-http";
import { activateCardArtSet, requireCardArtEditor } from "@/src/server/card-art-service";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ setId: string }> },
) {
  try {
    await requireCardArtEditor();
    const { setId } = await params;
    return cardArtJson(await activateCardArtSet(setId, await request.json().catch(() => null)));
  } catch (error) { return cardArtRouteError(error); }
}
