import { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { Tier, CapabilityProfile, negotiate, createDynamicPacket } from './vibemesh';

export const useVibeMesh = (remoteProfile: CapabilityProfile | null, onSendPacket?: (packet: any) => void) => {
  const [localProfile, setLocalProfile] = useState<CapabilityProfile>({
    maxSendTier: Tier.AVATAR3D,
    maxRenderTier: Tier.AVATAR3D,
    estimatedBandwidthKbps: 450,
    estimatedRttMs: 40,
    batteryLevel: 92,
    deviceClass: 3,
    lowDataMode: false,
  });

  const negotiated = useMemo(() => {
    if (!remoteProfile) return null;
    return negotiate(localProfile, remoteProfile);
  }, [localProfile, remoteProfile]);

  const sequenceRef = useRef(0);

  const sendAvatarState = useCallback((partialState: any) => {
    if (!negotiated || !onSendPacket) return;
    sequenceRef.current++;
    const packet = createDynamicPacket(
      "session-1",
      sequenceRef.current,
      negotiated.agreedSendTier,
      partialState
    );
    onSendPacket(packet);
  }, [negotiated, onSendPacket]);

  // Real battery & network monitoring
  useEffect(() => {
    if ('getBattery' in navigator) {
      (navigator as any).getBattery().then((b: any) => {
        const update = () => setLocalProfile(p => ({...p, batteryLevel: Math.floor(b.level * 100)}));
        update();
        b.addEventListener('levelchange', update);
      });
    }
  }, []);

  return {
    localProfile,
    setLocalProfile,
    negotiated,
    sendAvatarState,
    shouldRender3D: (negotiated?.agreedRenderTier ?? 0) >= Tier.AVATAR3D,
    currentTierName: Tier[negotiated?.agreedRenderTier ?? 0] || "TEXT",
  };
};