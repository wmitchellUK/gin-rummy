"use client";

import Image from "next/image";
import {
  Camera,
  CameraOff,
  LoaderCircle,
  Maximize2,
  Mic,
  MicOff,
  PhoneOff,
  Settings,
  Volume2,
  X,
} from "lucide-react";
import { RoomAudioRenderer, StartAudio } from "@livekit/components-react";
import {
  DisconnectReason,
  Room,
  RoomEvent,
  Track,
  type Participant,
  type VideoTrack,
} from "livekit-client";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { PlayerGameView } from "@/src/shared/game-view";

type CallPhase = "idle" | "prejoin" | "connecting" | "connected" | "reconnecting";
type MediaTokenResponse = {
  server_url?: string;
  participant_token?: string;
  error?: { code?: string };
};

type MediaContextValue = {
  available: boolean;
  phase: CallPhase;
  error: string;
  room: Room | null;
  remoteParticipant?: Participant;
  localVideo?: VideoTrack;
  remoteVideo?: VideoTrack;
  localMicEnabled: boolean;
  localCameraEnabled: boolean;
  localSpeaking: boolean;
  remoteSpeaking: boolean;
  remoteMicEnabled: boolean;
  openPrejoin: () => void;
  toggleMicrophone: () => Promise<void>;
  toggleCamera: () => Promise<void>;
  leave: () => void;
  openSettings: () => void;
  openRemoteVideo: () => void;
};

const emptyContext: MediaContextValue = {
  available: false,
  phase: "idle",
  error: "",
  room: null,
  localMicEnabled: false,
  localCameraEnabled: false,
  localSpeaking: false,
  remoteSpeaking: false,
  remoteMicEnabled: false,
  openPrejoin() {},
  async toggleMicrophone() {},
  async toggleCamera() {},
  leave() {},
  openSettings() {},
  openRemoteVideo() {},
};

const MediaContext = createContext<MediaContextValue>(emptyContext);

export function MediaCall({ game, children }: { game: PlayerGameView; children: ReactNode }) {
  const isHumanGame = game.mode === "MULTIPLAYER" && game.opponent?.kind === "HUMAN";
  const [phase, setPhase] = useState<CallPhase>("idle");
  const [error, setError] = useState("");
  const [room, setRoom] = useState<Room | null>(null);
  const [revision, setRevision] = useState(0);
  const [prejoinMicrophone, setPrejoinMicrophone] = useState(false);
  const [prejoinCamera, setPrejoinCamera] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [largeVideoOpen, setLargeVideoOpen] = useState(false);
  const roomRef = useRef<Room | null>(null);

  const update = useCallback(() => setRevision((value) => value + 1), []);
  const leave = useCallback(() => {
    const current = roomRef.current;
    roomRef.current = null;
    if (current) void current.disconnect();
    setRoom(null);
    setPhase("idle");
    setSettingsOpen(false);
    setLargeVideoOpen(false);
    setPrejoinMicrophone(false);
    setPrejoinCamera(false);
  }, []);

  useEffect(() => leave, [game.gameId, leave]);

  const connect = useCallback(async () => {
    if (!isHumanGame || phase === "connecting" || roomRef.current) return;
    setPhase("connecting");
    setError("");
    const nextRoom = new Room({ adaptiveStream: true, dynacast: true });
    roomRef.current = nextRoom;
    const sync = () => update();
    const onReconnecting = () => setPhase("reconnecting");
    const onReconnected = () => setPhase("connected");
    const onDisconnected = (reason?: DisconnectReason) => {
      if (roomRef.current !== nextRoom) return;
      roomRef.current = null;
      setRoom(null);
      setPhase("idle");
      setLargeVideoOpen(false);
      if (reason === DisconnectReason.DUPLICATE_IDENTITY) setError("This call moved to another tab.");
    };
    nextRoom
      .on(RoomEvent.TrackSubscribed, sync)
      .on(RoomEvent.TrackUnsubscribed, sync)
      .on(RoomEvent.TrackMuted, sync)
      .on(RoomEvent.TrackUnmuted, sync)
      .on(RoomEvent.LocalTrackPublished, sync)
      .on(RoomEvent.LocalTrackUnpublished, sync)
      .on(RoomEvent.ParticipantConnected, sync)
      .on(RoomEvent.ParticipantDisconnected, sync)
      .on(RoomEvent.ActiveSpeakersChanged, sync)
      .on(RoomEvent.Reconnecting, onReconnecting)
      .on(RoomEvent.Reconnected, onReconnected)
      .on(RoomEvent.Disconnected, onDisconnected);
    try {
      const response = await fetch(`/api/games/${game.gameId}/media-token`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
      });
      const body = await response.json().catch(() => ({})) as MediaTokenResponse;
      if (!response.ok || !body.server_url || !body.participant_token) {
        throw new Error(body.error?.code ?? "MEDIA_CONNECTION_FAILED");
      }
      if (roomRef.current !== nextRoom) { await nextRoom.disconnect(); return; }
      await nextRoom.connect(body.server_url, body.participant_token, { autoSubscribe: true });
      if (roomRef.current !== nextRoom) { await nextRoom.disconnect(); return; }
      setRoom(nextRoom);
      setPhase("connected");
      if (prejoinMicrophone) {
        try { await nextRoom.localParticipant.setMicrophoneEnabled(true); }
        catch (cause) { setError(permissionErrorMessage("microphone", cause)); }
      }
      if (prejoinCamera) {
        try { await nextRoom.localParticipant.setCameraEnabled(true); }
        catch (cause) { setError(permissionErrorMessage("camera", cause)); }
      }
      update();
    } catch (cause) {
      if (roomRef.current === nextRoom) {
        roomRef.current = null;
        setRoom(null);
        setPhase("idle");
        setError(mediaErrorMessage(cause));
      }
      await nextRoom.disconnect();
    }
  }, [game.gameId, isHumanGame, phase, prejoinCamera, prejoinMicrophone, update]);

  const toggleMicrophone = useCallback(async () => {
    const current = roomRef.current;
    if (!current) return;
    setError("");
    try {
      const publication = current.localParticipant.getTrackPublication(Track.Source.Microphone);
      await current.localParticipant.setMicrophoneEnabled(!publication || publication.isMuted);
      update();
    } catch (cause) { setError(permissionErrorMessage("microphone", cause)); }
  }, [update]);

  const toggleCamera = useCallback(async () => {
    const current = roomRef.current;
    if (!current) return;
    setError("");
    try {
      const publication = current.localParticipant.getTrackPublication(Track.Source.Camera);
      await current.localParticipant.setCameraEnabled(!publication || publication.isMuted);
      update();
    } catch (cause) { setError(permissionErrorMessage("camera", cause)); }
  }, [update]);

  const remoteParticipant = room ? Array.from(room.remoteParticipants.values())[0] : undefined;
  const localCameraPublication = room?.localParticipant.getTrackPublication(Track.Source.Camera);
  const localMicPublication = room?.localParticipant.getTrackPublication(Track.Source.Microphone);
  const remoteCameraPublication = remoteParticipant?.getTrackPublication(Track.Source.Camera);
  const remoteMicPublication = remoteParticipant?.getTrackPublication(Track.Source.Microphone);
  const localVideo = localCameraPublication && !localCameraPublication.isMuted ? localCameraPublication.videoTrack : undefined;
  const remoteVideo = remoteCameraPublication && !remoteCameraPublication.isMuted ? remoteCameraPublication.videoTrack : undefined;
  // revision intentionally makes participant/publication mutations observable to React.
  void revision;

  const value = useMemo<MediaContextValue>(() => ({
    available: isHumanGame && (game.status === "PLAYING" || game.status === "HAND_COMPLETE" || phase !== "idle"),
    phase,
    error,
    room,
    remoteParticipant,
    localVideo,
    remoteVideo,
    localMicEnabled: Boolean(localMicPublication && !localMicPublication.isMuted),
    localCameraEnabled: Boolean(localCameraPublication && !localCameraPublication.isMuted),
    localSpeaking: Boolean(room?.localParticipant.isSpeaking),
    remoteSpeaking: Boolean(remoteParticipant?.isSpeaking),
    remoteMicEnabled: Boolean(remoteMicPublication && !remoteMicPublication.isMuted),
    openPrejoin: () => { setError(""); setPhase("prejoin"); },
    toggleMicrophone,
    toggleCamera,
    leave,
    openSettings: () => setSettingsOpen(true),
    openRemoteVideo: () => { if (remoteVideo) setLargeVideoOpen(true); },
  }), [
    error, game.status, isHumanGame, leave, localCameraPublication, localMicPublication,
    localVideo, phase, remoteMicPublication, remoteParticipant, remoteVideo, room,
    toggleCamera, toggleMicrophone,
  ]);

  return <MediaContext.Provider value={value}>
    {children}
    {room && <><RoomAudioRenderer room={room} /><StartAudio room={room} label="Allow call audio" className="media-audio-prompt" /></>}
    {phase === "prejoin" && <PrejoinPanel
      microphone={prejoinMicrophone}
      camera={prejoinCamera}
      error={error}
      onMicrophone={(enabled) => void requestPrejoinPermission("microphone", enabled, setPrejoinMicrophone, setError)}
      onCamera={(enabled) => void requestPrejoinPermission("camera", enabled, setPrejoinCamera, setError)}
      onClose={() => { setPhase("idle"); setPrejoinMicrophone(false); setPrejoinCamera(false); }}
      onJoin={() => void connect()}
    />}
    {settingsOpen && room && <DevicePanel room={room} onClose={() => setSettingsOpen(false)} onError={setError} />}
    {largeVideoOpen && remoteVideo && <LargeVideo
      track={remoteVideo}
      name={game.opponent?.displayName ?? "Opponent"}
      onClose={() => setLargeVideoOpen(false)}
    />}
  </MediaContext.Provider>;
}

export function MediaDock() {
  const media = useContext(MediaContext);
  if (!media.available) return null;
  if (media.phase === "prejoin") return null;
  if (media.phase === "idle") return <aside className="media-dock" aria-label="Voice and video call">
    <button type="button" className="media-join" onClick={media.openPrejoin}><Volume2 aria-hidden="true" /> Join call</button>
    {media.error && <span className="media-inline-error" role="alert">{media.error}</span>}
  </aside>;
  if (media.phase === "connecting") return <aside className="media-dock" aria-label="Voice and video call"><span role="status"><LoaderCircle className="media-spinner" aria-hidden="true" /> Connecting to call…</span><button type="button" className="media-cancel-connect" onClick={media.leave}>Cancel</button></aside>;
  return <aside className="media-dock" aria-label="Voice and video call">
    <span className="media-call-status" role="status">{media.phase === "reconnecting" ? "Reconnecting…" : media.remoteParticipant ? "Call connected" : "Waiting in call"}</span>
    <MediaControlButtons media={media} settings />
    {media.error && <span className="media-inline-error" role="alert">{media.error}</span>}
  </aside>;
}

export function MediaModalControls() {
  const media = useContext(MediaContext);
  if (media.phase !== "connected" && media.phase !== "reconnecting") return null;
  return <section className="media-modal-controls" aria-label="Call controls">
    <span>{media.phase === "reconnecting" ? "Call reconnecting…" : "Call connected"}</span>
    <MediaControlButtons media={media} />
    {media.error && <span className="media-inline-error" role="alert">{media.error}</span>}
  </section>;
}

function MediaControlButtons({ media, settings = false }: { media: MediaContextValue; settings?: boolean }) {
  return <div className="media-control-buttons">
    <button type="button" onClick={() => void media.toggleMicrophone()} aria-label={media.localMicEnabled ? "Mute microphone" : "Turn on microphone"}>{media.localMicEnabled ? <Mic aria-hidden="true" /> : <MicOff aria-hidden="true" />}</button>
    <button type="button" onClick={() => void media.toggleCamera()} aria-label={media.localCameraEnabled ? "Turn off camera" : "Turn on camera"}>{media.localCameraEnabled ? <Camera aria-hidden="true" /> : <CameraOff aria-hidden="true" />}</button>
    {settings && <button type="button" onClick={media.openSettings} aria-label="Call device settings"><Settings aria-hidden="true" /></button>}
    <button type="button" className="media-leave" onClick={media.leave} aria-label="Leave call"><PhoneOff aria-hidden="true" /></button>
  </div>;
}

export function MediaAvatar({ kind, name }: { kind: "local" | "remote" | "bot"; name: string }) {
  const media = useContext(MediaContext);
  if (kind === "bot") return <div className="media-avatar bot-avatar" aria-label={`${name}, computer opponent`}><Image src="/avatars/Naia-pomeranian.webp" alt="" width={88} height={88} priority /></div>;
  const local = kind === "local";
  const track = local ? media.localVideo : media.remoteVideo;
  const connected = media.phase === "connected" || media.phase === "reconnecting";
  const connecting = media.phase === "connecting" || media.phase === "reconnecting";
  const participantPresent = local || Boolean(media.remoteParticipant);
  const speaking = local ? media.localSpeaking : media.remoteSpeaking;
  const microphoneEnabled = local ? media.localMicEnabled : media.remoteMicEnabled;
  const status = connecting ? "Connecting" : !connected ? "Not in call" : !participantPresent ? "Not in call" : speaking ? "Speaking" : microphoneEnabled ? "In call" : "Muted";
  const content = <>
    <span className={`media-avatar ${local ? "you-avatar" : ""}${speaking ? " is-speaking" : ""}${connecting ? " is-connecting" : ""}`}>
      {track ? <VideoSurface track={track} mirrored={local} /> : <span aria-hidden="true">{initials(name)}</span>}
    </span>
    <span className="media-avatar-status"><span aria-hidden="true">{status === "Muted" ? "⌁" : status === "Speaking" ? "◖" : status === "Connecting" ? "…" : status === "In call" ? "●" : "○"}</span>{status}</span>
    {!local && track && <Maximize2 className="media-expand-icon" aria-hidden="true" />}
  </>;
  return !local && track
    ? <button type="button" className="media-avatar-button" aria-label={`Enlarge ${name}'s video`} onClick={media.openRemoteVideo}>{content}</button>
    : <div className="media-avatar-wrap" aria-label={`${local ? "You" : name}: ${status}`}>{content}</div>;
}

function VideoSurface({ track, mirrored = false }: { track: VideoTrack; mirrored?: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    track.attach(element);
    return () => { track.detach(element); };
  }, [track]);
  return <video ref={ref} autoPlay playsInline muted={mirrored} className={mirrored ? "is-mirrored" : ""} />;
}

function PrejoinPanel(props: {
  microphone: boolean;
  camera: boolean;
  error: string;
  onMicrophone: (enabled: boolean) => void;
  onCamera: (enabled: boolean) => void;
  onClose: () => void;
  onJoin: () => void;
}) {
  const titleId = "media-prejoin-title";
  const panel = useRef<HTMLDivElement>(null);
  useDialogKeyboard(panel, props.onClose);
  return <div className="media-dialog-backdrop"><div ref={panel} className="media-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId}>
    <button type="button" className="media-dialog-close" onClick={props.onClose} aria-label="Close call setup"><X aria-hidden="true" /></button>
    <p className="eyebrow">Private table call</p>
    <h2 id={titleId} tabIndex={-1}>Join voice and video</h2>
    <p>Your microphone and camera begin off. Turn either on only when you want to share it.</p>
    <div className="prejoin-toggles">
      <button type="button" aria-pressed={props.microphone} onClick={() => props.onMicrophone(!props.microphone)}>{props.microphone ? <Mic aria-hidden="true" /> : <MicOff aria-hidden="true" />} Microphone {props.microphone ? "on" : "off"}</button>
      <button type="button" aria-pressed={props.camera} onClick={() => props.onCamera(!props.camera)}>{props.camera ? <Camera aria-hidden="true" /> : <CameraOff aria-hidden="true" />} Camera {props.camera ? "on" : "off"}</button>
    </div>
    {props.error && <p className="media-error" role="alert">{props.error}</p>}
    <button type="button" className="action-button primary" onClick={props.onJoin}>Join call</button>
    <small>Joining with both off lets you listen without sharing audio or video.</small>
  </div></div>;
}

function DevicePanel({ room, onClose, onError }: { room: Room; onClose: () => void; onError: (error: string) => void }) {
  const titleId = "media-devices-title";
  const panel = useRef<HTMLDivElement>(null);
  const [microphones, setMicrophones] = useState<MediaDeviceInfo[]>([]);
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
  const [speakers, setSpeakers] = useState<MediaDeviceInfo[]>([]);
  useDialogKeyboard(panel, onClose);
  useEffect(() => {
    let active = true;
    void Promise.all([
      Room.getLocalDevices("audioinput", true),
      Room.getLocalDevices("videoinput", true),
      Room.getLocalDevices("audiooutput", false),
    ])
      .then(([audio, video, output]) => { if (active) { setMicrophones(audio); setCameras(video); setSpeakers(output); } })
      .catch((cause) => onError(permissionErrorMessage("devices", cause)));
    return () => { active = false; };
  }, [onError]);
  async function choose(kind: MediaDeviceKind, deviceId: string) {
    try { await room.switchActiveDevice(kind, deviceId); }
    catch (cause) { onError(permissionErrorMessage(kind === "audioinput" ? "microphone" : kind === "videoinput" ? "camera" : "speaker", cause)); }
  }
  return <div className="media-dialog-backdrop"><div ref={panel} className="media-dialog device-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId}>
    <button type="button" className="media-dialog-close" onClick={onClose} aria-label="Close device settings"><X aria-hidden="true" /></button>
    <p className="eyebrow">Call settings</p><h2 id={titleId} tabIndex={-1}>Choose devices</h2>
    <label>Microphone<select defaultValue={room.getActiveDevice("audioinput")} onChange={(event) => void choose("audioinput", event.target.value)}>{microphones.map((device, index) => <option key={device.deviceId} value={device.deviceId}>{device.label || `Microphone ${index + 1}`}</option>)}</select></label>
    <label>Camera<select defaultValue={room.getActiveDevice("videoinput")} onChange={(event) => void choose("videoinput", event.target.value)}>{cameras.map((device, index) => <option key={device.deviceId} value={device.deviceId}>{device.label || `Camera ${index + 1}`}</option>)}</select></label>
    {speakers.length > 0 && <label>Speaker<select defaultValue={room.getActiveDevice("audiooutput")} onChange={(event) => void choose("audiooutput", event.target.value)}>{speakers.map((device, index) => <option key={device.deviceId} value={device.deviceId}>{device.label || `Speaker ${index + 1}`}</option>)}</select></label>}
  </div></div>;
}

function LargeVideo({ track, name, onClose }: { track: VideoTrack; name: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return <aside className="media-large-video" role="dialog" aria-label={`${name}'s video`}>
    <VideoSurface track={track} />
    <span>{name}</span>
    <button type="button" onClick={onClose} aria-label={`Close ${name}'s larger video`}><X aria-hidden="true" /></button>
  </aside>;
}

function useDialogKeyboard(ref: React.RefObject<HTMLDivElement | null>, onClose: () => void) {
  useEffect(() => {
    const root = ref.current;
    const backdrop = root?.parentElement;
    const siblings = Array.from(backdrop?.parentElement?.children ?? [])
      .filter((element): element is HTMLElement => element instanceof HTMLElement && element !== backdrop)
      .map((element) => ({ element, ariaHidden: element.getAttribute("aria-hidden"), inert: element.inert }));
    siblings.forEach(({ element }) => { element.setAttribute("aria-hidden", "true"); element.inert = true; });
    const title = root?.querySelector<HTMLElement>("h2");
    title?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { onClose(); return; }
      if (event.key !== "Tab") return;
      const controls = Array.from(root?.querySelectorAll<HTMLElement>('button:not([disabled]), select, [tabindex]:not([tabindex="-1"])') ?? []);
      const first = controls[0]; const last = controls.at(-1);
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    root?.addEventListener("keydown", onKey);
    return () => {
      root?.removeEventListener("keydown", onKey);
      siblings.forEach(({ element, ariaHidden, inert }) => {
        if (ariaHidden === null) element.removeAttribute("aria-hidden"); else element.setAttribute("aria-hidden", ariaHidden);
        element.inert = inert;
      });
    };
  }, [onClose, ref]);
}

async function requestPrejoinPermission(
  kind: "microphone" | "camera",
  enabled: boolean,
  update: (enabled: boolean) => void,
  setError: (error: string) => void,
) {
  if (!enabled) { update(false); return; }
  setError("");
  try {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error("MEDIA_DEVICES_UNAVAILABLE");
    const stream = await navigator.mediaDevices.getUserMedia(kind === "microphone" ? { audio: true } : { video: true });
    stream.getTracks().forEach((track) => track.stop());
    update(true);
  } catch (cause) { setError(permissionErrorMessage(kind, cause)); }
}

function permissionErrorMessage(kind: string, cause: unknown) {
  const denied = cause instanceof DOMException && (cause.name === "NotAllowedError" || cause.name === "SecurityError");
  return denied
    ? `Your browser blocked ${kind} access. You can change that permission in site settings.`
    : `We couldn’t use your ${kind}. Check the device and try again.`;
}

function mediaErrorMessage(cause: unknown) {
  const code = cause instanceof Error ? cause.message : "";
  if (code === "MEDIA_NOT_CONFIGURED") return "Voice and video are not available at this table.";
  if (code === "MEDIA_UNSUPPORTED_STATE" || code === "MEDIA_UNSUPPORTED_GAME") return "This table cannot start a call.";
  if (code === "MEDIA_MEMBERSHIP_REQUIRED" || code === "UNAUTHENTICATED") return "Only seated players can join this call.";
  return "We couldn’t connect the call. Check your network and try again.";
}

function initials(value: string) {
  return value.trim().split(/\s+/).slice(0, 2).map((part) => part[0] ?? "").join("").toUpperCase() || "?";
}
