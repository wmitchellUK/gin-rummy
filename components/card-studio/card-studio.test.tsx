import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CardArtSetResponse, CardArtSetsResponse } from "@/src/shared/card-art";
import { CardStudio } from "./card-studio";

vi.mock("react-easy-crop", async () => {
  const React = await import("react");
  return {
    default: function CropperMock(props: { onCropComplete: (area: { x: number; y: number; width: number; height: number }) => void }) {
      React.useEffect(() => {
        props.onCropComplete({ x: 10, y: 15, width: 40, height: 60 });
      }, []); // eslint-disable-line react-hooks/exhaustive-deps
      return <div data-testid="cropper">Crop surface</div>;
    },
  };
});

const SET_ID = "10000000-0000-4000-8000-000000000001";

function artSet(overrides: Partial<CardArtSetResponse> = {}): CardArtSetResponse {
  return {
    id: SET_ID,
    name: "Family portraits",
    draftManifest: {},
    draftVersion: 2,
    publishedManifest: {},
    publishedRevision: 1,
    archivedAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    isActive: false,
    ...overrides,
  };
}

function catalog(set = artSet(), activeSetId: string | null = null): CardArtSetsResponse {
  return { activeSetId, activeRevision: activeSetId ? set.publishedRevision : 0, sets: [set] };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function studioFetcher(handler?: (path: string, init?: RequestInit) => Response | Promise<Response>) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input);
    if (path.includes("includeArchived")) return json(catalog());
    if (handler) return handler(path, init);
    return json({});
  });
}

async function openSet(fetcher: ReturnType<typeof studioFetcher>) {
  render(<CardStudio fetcher={fetcher} />);
  await userEvent.setup().click(await screen.findByRole("button", { name: /Family portraits/ }));
  await screen.findByRole("heading", { name: "Family portraits" });
}

beforeEach(() => {
  Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn(() => "blob:portrait") });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("CardStudio", () => {
  it("supports keyboard dialog dismissal and restores focus", async () => {
    const user = userEvent.setup();
    const fetcher = studioFetcher();
    await openSet(fetcher);
    const preview = screen.getByRole("button", { name: "Preview J of clubs" });

    preview.focus();
    await user.keyboard("{Enter}");
    expect(screen.getByRole("dialog", { name: "J of clubs preview" })).toBeInTheDocument();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(preview).toHaveFocus();
  });

  it("submits the locked crop as normalized coordinates", async () => {
    const fetcher = studioFetcher((path, init) => {
      if (path.includes("/slots/J:CLUBS") && init?.method === "POST") {
        return json(artSet({
          draftManifest: { "J:CLUBS": "https://assets.example/jack.webp" },
          draftVersion: 3,
        }));
      }
      return json({});
    });
    await openSet(fetcher);
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Upload J of clubs artwork" }));
    const fileInput = document.querySelector<HTMLInputElement>('input[type="file"]')!;
    await user.upload(fileInput, new File(["portrait"], "portrait.png", { type: "image/png" }));
    expect(await screen.findByTestId("cropper")).toBeInTheDocument();
    await user.click(await screen.findByRole("button", { name: "Upload crop" }));

    const uploadCall = fetcher.mock.calls.find(([path, init]) => String(path).includes("/slots/J:CLUBS") && init?.method === "POST");
    expect(uploadCall).toBeDefined();
    const formData = uploadCall?.[1]?.body as FormData;
    expect(JSON.parse(String(formData.get("crop")))).toEqual({ x: 0.1, y: 0.15, width: 0.4, height: 0.6 });
    expect(formData.get("expectedDraftVersion")).toBe("2");
    await waitFor(() => expect(screen.queryByRole("dialog", { name: /Crop/ })).not.toBeInTheDocument());
  });

  it("preserves the crop and explains an optimistic conflict", async () => {
    const fetcher = studioFetcher((path, init) => {
      if (path.includes("/slots/Q:HEARTS") && init?.method === "POST") return json({ error: { code: "DRAFT_CONFLICT" } }, 409);
      return json({});
    });
    await openSet(fetcher);
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Upload Q of hearts artwork" }));
    await user.upload(document.querySelector<HTMLInputElement>('input[type="file"]')!, new File(["portrait"], "portrait.webp", { type: "image/webp" }));
    await user.click(await screen.findByRole("button", { name: "Upload crop" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("This draft changed elsewhere. Your current work is still here");
    expect(screen.getByRole("dialog", { name: "Crop q of hearts" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Upload crop" })).toBeEnabled();
  });

  it("keeps a failed create value available and succeeds on retry", async () => {
    let attempts = 0;
    const created = artSet({ id: "20000000-0000-4000-8000-000000000002", name: "Sunday table" });
    const fetcher = studioFetcher((_path, init) => {
      if (init?.method === "POST") {
        attempts += 1;
        return attempts === 1 ? json({ error: { code: "INTERNAL_ERROR" } }, 500) : json(created, 201);
      }
      return json({});
    });
    render(<CardStudio fetcher={fetcher} />);
    const user = userEvent.setup();
    const input = await screen.findByLabelText("New set name");
    await user.type(input, "Sunday table");

    await user.click(screen.getByRole("button", { name: "Create set" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Your changes were not lost");
    expect(input).toHaveValue("Sunday table");

    await user.click(screen.getByRole("button", { name: "Create set" }));
    expect(await screen.findByRole("heading", { name: "Sunday table" })).toBeInTheDocument();
    expect(input).toHaveValue("");
  });

  it("requires confirmation before global activation", async () => {
    const fetcher = studioFetcher((path, init) => {
      if (path.endsWith("/activate") && init?.method === "POST") {
        return json({
          source: "CUSTOM",
          setId: SET_ID,
          setName: "Family portraits",
          revision: 2,
          manifest: {},
        });
      }
      return json({});
    });
    await openSet(fetcher);
    const user = userEvent.setup();
    const callsBefore = fetcher.mock.calls.length;

    await user.click(screen.getByRole("button", { name: "Activate for all games" }));
    const dialog = screen.getByRole("dialog", { name: "Activate Family portraits?" });
    expect(within(dialog).getByText(/All open games will update/)).toBeInTheDocument();
    expect(within(dialog).getByText(/every future game/)).toBeInTheDocument();
    expect(fetcher).toHaveBeenCalledTimes(callsBefore);

    await user.click(within(dialog).getByRole("button", { name: "Yes, activate globally" }));
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(callsBefore + 1));
    expect(fetcher.mock.calls.at(-1)?.[0]).toBe(`/api/card-art/sets/${SET_ID}/activate`);
  });

  it("prevents the active set from being archived", async () => {
    const active = artSet({ isActive: true });
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes("includeArchived")) return json(catalog(active, SET_ID));
      return json({});
    });
    render(<CardStudio fetcher={fetcher} />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: /Family portraits/ }));

    expect(screen.getByRole("button", { name: "Archive" })).toBeDisabled();
    expect(screen.getByText("Active sets cannot be archived. Activate another design first.")).toBeInTheDocument();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
