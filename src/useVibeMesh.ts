import { useState, useCallback, useMemo } from 'react';
import {
  Tier,
  DeviceClass,
  AvatarState,
  CapabilityProfile,
  VibePacket,
  negotiate,
  createDynamicPacket,
} from './vibemesh';
 
let _sequence = 0;
const SESSION_ID = `shore-${Math.random().toString(36).slice(2, 8)}`;
 
const DEFAULT_LOCAL_PROFILE: CapabilityProfile = {
  maxSendTier: Tier.AVATAR3D,
  maxRenderTier: Tier.AVATAR3D,
  estimatedBandwidthKbps: 900,
  estimatedRttMs: 20,
  batteryLevel: 100,
  deviceClass: DeviceClass.HIGH,
  lowDataMode: false,
};
 
export function useVibeMesh(
  remoteProfile: CapabilityProfile,
  sendPacket: (packet: VibePacket) => void
) {
  const [localProfile, setLocalProfile] = useState<CapabilityProfile>(DEFAULT_LOCAL_PROFILE);
 
  const negotiated = useMemo(
    () => negotiate(localProfile, remoteProfile),
    [localProfile, remoteProfile]
  );
 
  const tierNames: Record<Tier, string> = {
    [Tier.UNSPECIFIED]: 'UNSPECIFIED',
    [Tier.TEXT]: 'TEXT',
    [Tier.GLYPH]: 'GLYPH',
    [Tier.SPRITE]: 'SPRITE',
    [Tier.PUPPET]: 'PUPPET',
    [Tier.AVATAR3D]: 'AVATAR3D',
  };
 
  const currentTierName = tierNames[negotiated.agreedSendTier] ?? 'UNKNOWN';
  const shouldRender3D = negotiated.agreedRenderTier >= Tier.AVATAR3D;
 
  const sendAvatarState = useCallback(
    (input: Partial<AvatarState>) => {
      const packet = createDynamicPacket(
        SESSION_ID,
        ++_sequence,
        negotiated.agreedSendTier,
        input
      );
      sendPacket(packet);
      return packet;
    },
    [negotiated.agreedSendTier, sendPacket]
  );
 
  return {
    localProfile,
    setLocalProfile,
    negotiated,
    sendAvatarState,
    shouldRender3D,
    currentTierName,
    sessionId: SESSION_ID,
  };
}
 