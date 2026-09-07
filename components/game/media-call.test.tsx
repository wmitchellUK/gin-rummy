import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PlayerGameView } from "@/src/shared/game-view";

type TestTrack = { attach: ReturnType<typeof vi.fn>; detach: ReturnType<typeof vi.fn> };
type TestPublication = { isMuted: boolean; videoTrack?: TestTrack };
type TestParticipant = {
  identity: string;
  isSpeaking: boolean;
  publications: Map<string, TestPublication>;
  getTrackPublication: (source: string) => TestPublication | undefined;
  setMicrophoneEnabled: ReturnType<typeof vi.fn>;
  setCameraEnabled: ReturnType<typeof vi.fn>;
};
type TestRoom = {
  handlers: Map<string, Set<(...args: unknown[]) => void>>;
  localParticipant: TestParticipant;
  remoteParticipants: Map<string, TestParticipant>;
  connect: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
  switchActiveDevice: ReturnType<typeof vi.fn>;
  getActiveDevice: ReturnType<typeof vi.fn>;
  emit: (event: string, ...args: unknown[]) => void;
};

const livekitState = vi.hoisted(() => ({
  rooms: [] as TestRoom[],
  MockParticipant: null as unknown as new () => TestParticipant,
  cameraTrack: null as unknown as TestTrack,
}));

vi.mock("@livekit/components-react", () => ({
  RoomAudioRenderer: () => <div data-testid="room-audio" />,
  StartAudio: () => null,
}));

vi.mock("livekit-client", () => {
  const RoomEvent = {
    TrackSubscribed: "trackSubscribed",
    TrackUnsubscribed: "trackUnsubscribed",
    TrackMuted: "trackMuted",
    TrackUnmuted: "trackUnmuted",
    LocalTrackPublished: "localTrackPublished",
    LocalTrackUnpublished: "localTrackUnpublished",
    ParticipantConnected: "participantConnected",
    ParticipantDisconnected: "participantDisconnected",
    ActiveSpeakersChanged: "activeSpeakersChanged",
    Reconnecting: "reconnecting",
    Reconnected: "reconnected",
    Disconnected: "disconnected",
  };
  const cameraTrack = { attach: vi.fn(), detach: vi.fn() };
  class MockParticipant {
    identity = "local";
    isSpeaking = false;
    publications = new Map<string, { isMuted: boolean; videoTrack?: typeof cameraTrack }>();
    getTrackPublication(source: string) { return this.publications.get(source); }
    setMicrophoneEnabled = vi.fn(async (enabled: boolean) => {
      this.publications.set("microphone", { isMuted: !enabled });
    });
    setCameraEnabled = vi.fn(async (enabled: boolean) => {
      this.publications.set("camera", { isMuted: !enabled, videoTrack: cameraTrack });
    });
  }
  class MockRoom {
    static getLocalDevices = vi.fn(async (kind: string) => [{ deviceId: `${kind}-1`, label: `${kind} one` }]);
    handlers = new Map<string, Set<(...args: unknown[]) => void>>();
    localParticipant = new MockParticipant();
    remoteParticipants = new Map<string, MockParticipant>();
    connect = vi.fn(async () => undefined);
    disconnect = vi.fn(async () => undefined);
    switchActiveDevice = vi.fn(async () => true);
    getActiveDevice = vi.fn(() => undefined);
    constructor() { livekitState.rooms.push(this); }
    on(event: string, handler: (...args: unknown[]) => void) {
      const handlers = this.handlers.get(event) ?? new Set();
      handlers.add(handler); this.handlers.set(event, handlers); return this;
    }
    emit(event: string, ...args: unknown[]) { this.handlers.get(event)?.forEach((handler) => handler(...args)); }
  }
  livekitState.MockParticipant = MockParticipant;
  livekitState.cameraTrack = cameraTrack;
  return {
    Room: MockRoom,
    RoomEvent,
    Track: { Source: { Camera: "camera", Microphone: "microphone" } },
    DisconnectReason: { DUPLICATE_IDENTITY: 2 },
  };
});

import { MediaAvatar, MediaCall, MediaDock, MediaModalControls } from "./media-call";

const humanGame = (status: PlayerGameView["status"] = "PLAYING"): PlayerGameView => ({
  gameId: "game-1",
  version: 1,
  mode: "MULTIPLAYER",
  status,
  phase: status === "HAND_COMPLETE" ? "HAND_COMPLETE" : status === "COMPLETE" ? "GAME_COMPLETE" : "AWAITING_DRAW",
  rules: { knockThreshold: 10, ginBonus: 25, undercutBonus: 25, matchTarget: 100 },
  you: { seat: 0, displayName: "Ada", score: 0, hand: [] },
  opponent: { seat: 1, displayName: "Grace", kind: "HUMAN", score: 0, cardCount: 10 },
  dealerId: null,
  stockCount: 31,
  discardPile: [],
  legalControls: [],
  botActionPending: false,
});

function Harness({ game = humanGame() }: { game?: PlayerGameView }) {
  return <MediaCall game={game}>
    <MediaDock />
    <MediaAvatar kind="local" name="Ada" />
    <MediaAvatar kind="remote" name="Grace" />
    <MediaModalControls />
  </MediaCall>;
}

function currentRoom() {
  return livekitState.rooms.at(-1)!;
}

async function openAndJoin() {
  fireEvent.click(screen.getByRole("button", { name: "Join call" }));
  const dialog = screen.getByRole("dialog", { name: "Join voice and video" });
  fireEvent.click(within(dialog).getByRole("button", { name: "Join call" }));
  await screen.findByText("Waiting in call");
}

beforeEach(() => {
  livekitState.rooms.length = 0;
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
    server_url: "wss://example.livekit.cloud",
    participant_token: "token",
  }), { status: 200, headers: { "content-type": "application/json" } })));
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia: vi.fn() },
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("MediaCall", () => {
  it("defaults both devices off and permits a receive-only join", async () => {
    render(<Harness />);
    expect(screen.getAllByText("Not in call")).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "Join call" }));
    const dialog = screen.getByRole("dialog", { name: "Join voice and video" });
    expect(within(dialog).getByRole("button", { name: "Microphone off" })).toHaveAttribute("aria-pressed", "false");
    expect(within(dialog).getByRole("button", { name: "Camera off" })).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(within(dialog).getByRole("button", { name: "Join call" }));
    await screen.findByText("Waiting in call");
    const room = currentRoom();
    expect(room.connect).toHaveBeenCalledWith("wss://example.livekit.cloud", "token", { autoSubscribe: true });
    expect(room.localParticipant.publications.size).toBe(0);
    expect(screen.getByTestId("room-audio")).toBeInTheDocument();
  });

  it("requests permission only when opted in and reports denial", async () => {
    const denied = new DOMException("denied", "NotAllowedError");
    vi.mocked(navigator.mediaDevices.getUserMedia).mockRejectedValueOnce(denied);
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Join call" }));
    fireEvent.click(screen.getByRole("button", { name: "Microphone off" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("browser blocked microphone access");
    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledWith({ audio: true });
    expect(screen.getByRole("button", { name: "Microphone off" })).toHaveAttribute("aria-pressed", "false");
  });

  it("attaches video, exposes controls and speaking/reconnecting states, and cleans up", async () => {
    const { MockParticipant, cameraTrack } = livekitState;
    const { rerender, unmount } = render(<Harness />);
    await openAndJoin();
    const room = currentRoom();

    fireEvent.click(screen.getAllByRole("button", { name: "Turn on microphone" })[0]!);
    await waitFor(() => expect(screen.getAllByRole("button", { name: "Mute microphone" }).length).toBeGreaterThan(0));
    fireEvent.click(screen.getAllByRole("button", { name: "Mute microphone" })[0]!);
    await waitFor(() => expect(screen.getAllByRole("button", { name: "Turn on microphone" }).length).toBeGreaterThan(0));
    fireEvent.click(screen.getAllByRole("button", { name: "Turn on camera" })[0]!);
    await waitFor(() => expect(cameraTrack.attach).toHaveBeenCalled());

    fireEvent.click(screen.getByRole("button", { name: "Call device settings" }));
    const devices = await screen.findByRole("dialog", { name: "Choose devices" });
    fireEvent.change(within(devices).getByLabelText("Camera"), { target: { value: "videoinput-1" } });
    await waitFor(() => expect(room.switchActiveDevice).toHaveBeenCalledWith("videoinput", "videoinput-1"));
    fireEvent.click(within(devices).getByRole("button", { name: "Close device settings" }));

    const remote = new MockParticipant();
    remote.identity = "remote";
    remote.publications.set("camera", { isMuted: false, videoTrack: cameraTrack });
    remote.publications.set("microphone", { isMuted: false });
    remote.isSpeaking = true;
    room.remoteParticipants.set("remote", remote);
    room.emit("participantConnected", remote);
    await waitFor(() => expect(screen.getByRole("button", { name: "Enlarge Grace's video" })).toBeInTheDocument());
    expect(screen.getByText("Speaking")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Enlarge Grace's video" }));
    expect(screen.getByRole("dialog", { name: "Grace's video" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Close Grace's larger video" }));
    remote.publications.delete("camera");
    room.emit("trackUnsubscribed");
    await waitFor(() => expect(screen.queryByRole("button", { name: "Enlarge Grace's video" })).not.toBeInTheDocument());
    expect(cameraTrack.detach).toHaveBeenCalled();

    room.emit("reconnecting");
    expect(await screen.findByText("Reconnecting…")).toBeInTheDocument();
    room.emit("reconnected");
    expect((await screen.findAllByText("Call connected")).length).toBeGreaterThan(0);

    rerender(<Harness game={humanGame("HAND_COMPLETE")} />);
    expect(screen.getByLabelText("Call controls")).toBeInTheDocument();
    rerender(<Harness game={humanGame("COMPLETE")} />);
    expect(screen.getByLabelText("Call controls")).toBeInTheDocument();
    expect(livekitState.rooms).toHaveLength(1);

    fireEvent.click(within(screen.getByLabelText("Call controls")).getByRole("button", { name: "Leave call" }));
    await waitFor(() => expect(room.disconnect).toHaveBeenCalled());
    expect(screen.queryByLabelText("Call controls")).not.toBeInTheDocument();
    unmount();
    expect(cameraTrack.detach).toHaveBeenCalled();
  });

  it("does not offer calls in waiting or Naia games", () => {
    const { rerender } = render(<Harness game={humanGame("WAITING")} />);
    expect(screen.queryByRole("button", { name: "Join call" })).not.toBeInTheDocument();
    rerender(<Harness game={humanGame("COMPLETE")} />);
    expect(screen.queryByRole("button", { name: "Join call" })).not.toBeInTheDocument();
    rerender(<Harness game={{ ...humanGame(), mode: "SINGLE_PLAYER", opponent: { seat: 1, displayName: "Naia", kind: "BOT", score: 0, cardCount: 10 } }} />);
    expect(screen.queryByRole("button", { name: "Join call" })).not.toBeInTheDocument();
  });
});
