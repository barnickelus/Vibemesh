/* ========================= ENUMS & TYPES ========================= */

export enum Tier { UNSPECIFIED = 0, TEXT = 1, GLYPH = 2, SPRITE = 3, PUPPET = 4, AVATAR3D = 5 }
export enum DeviceClass { UNSPECIFIED = 0, LOW = 1, MID = 2, HIGH = 3 }
export enum GestureType { UNSPECIFIED = 0, NOD = 1, SHAKE = 2, LAUGH = 3, FIST_PUMP = 4 }

export interface Vec3 { x: number; y: number; z: number; }
export interface Blendshapes { [key: string]: number; }

export interface ProsodyParams {
  pitch: number;           // -1 to 1
  speakingRate: number;    // 0.5 to 2.0
  energy: number;          // 0 to 1
  expressiveness: number;  // 0 to 1
  currentViseme?: string;
}

export interface AvatarState {
  timestampMs: number;
  sequence: number;
  senderTier: Tier;
  isDelta: boolean;
  headRotation?: Vec3;
  blendshapes: Blendshapes;
  gestures: GestureType[];
  transcribedText?: string;
  isSpeaking: boolean;
  valence: number;
  arousal: number;

  // Voice clone support
  prosody?: ProsodyParams;
}

export interface CapabilityProfile {
  maxSendTier: Tier;
  maxRenderTier: Tier;
  estimatedBandwidthKbps: number;
  estimatedRttMs: number;
  batteryLevel: number;
  deviceClass: DeviceClass;
  lowDataMode: boolean;
}

export type VibePacket = {
  schemaVersion: number;
  sessionId: string;
  packetSequence: number;
  sentAtMs: number;
  type: "avatar";
  avatarState: AvatarState;
};

/* ========================= UTILS & NEGOTIATION ========================= */

export const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

export function negotiate(local: CapabilityProfile, remote: CapabilityProfile) {
  const maxSend = Math.min(local.maxSendTier, remote.maxRenderTier);
  const maxReceive = Math.min(remote.maxSendTier, local.maxRenderTier);
  const bw = Math.min(local.estimatedBandwidthKbps, remote.estimatedBandwidthKbps);

  let cap = Tier.AVATAR3D;
  if (bw < 30 || local.lowDataMode || remote.lowDataMode) cap = Tier.GLYPH;
  else if (bw < 80 || local.batteryLevel < 15) cap = Tier.SPRITE;
  else if (bw < 250 || local.batteryLevel < 30) cap = Tier.PUPPET;

  return {
    agreedSendTier: Math.min(maxSend, cap),
    agreedRenderTier: Math.min(maxReceive, cap),
  };
}

export function createDynamicPacket(
  sessionId: string,
  sequence: number,
  tier: Tier,
  input: Partial<AvatarState>
): VibePacket {
  const isHighTier = tier >= Tier.PUPPET;

  return {
    schemaVersion: 1,
    sessionId,
    packetSequence: sequence,
    sentAtMs: Date.now(),
    type: "avatar",
    avatarState: {
      timestampMs: Date.now(),
      sequence,
      senderTier: tier,
      isDelta: true,
      isSpeaking: input.isSpeaking ?? false,
      valence: clamp(input.valence ?? 0, -1, 1),
      arousal: clamp(input.arousal ?? 0, 0, 1),
      gestures: input.gestures ?? [],
      transcribedText: input.transcribedText || "",
      headRotation: isHighTier ? input.headRotation : undefined,
      blendshapes: isHighTier ? input.blendshapes ?? {} : {},
      prosody: input.prosody,
    },
  };
}