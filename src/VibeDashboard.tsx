import React, { useState, useEffect } from 'react';
import { useVibeMesh } from './useVibeMesh';
import { useVibeTransport } from './useVibeTransport';
import { VibeAvatarRenderer } from './VibeAvatarRenderer';
import { Vibe3DRenderer } from './Vibe3DRenderer';
import { VoiceClonePanel } from './VoiceClonePanel';
import { Tier, CapabilityProfile } from './vibemesh';

const MOCK_REMOTE: CapabilityProfile = {
  maxSendTier: Tier.AVATAR3D,
  maxRenderTier: Tier.AVATAR3D,
  estimatedBandwidthKbps: 900,
  estimatedRttMs: 28,
  batteryLevel: 88,
  deviceClass: 3,
  lowDataMode: false,
};

export const VibeDashboard = () => {
  const [sent, setSent] = useState(0);
  const [lastState, setLastState] = useState<any>(null);
  const [packetBytes, setPacketBytes] = useState(0);
  const [autoSend, setAutoSend] = useState(false);

  const transport = useVibeTransport();

  const { 
    localProfile, setLocalProfile, negotiated, sendAvatarState, 
    shouldRender3D, currentTierName 
  } = useVibeMesh(MOCK_REMOTE, transport.sendPacket);

  const handleSend = () => {
    const packet = sendAvatarState({
      transcribedText: "Yo CB from the Shore — 3 Guys pizza slice in hand!!",
      gestures: [4],
      isSpeaking: true,
      valence: 0.95,
      arousal: 0.98
    });
    setSent(s => s + 1);
    setLastState(packet.avatarState);
    setPacketBytes(JSON.stringify(packet).length);
  };

  useEffect(() => {
    if (!autoSend) return;
    const id = setInterval(handleSend, 1000);
    return () => clearInterval(id);
  }, [autoSend, sendAvatarState]);

  return (
    <div style={{ padding: '30px', background: '#0a0a1f', color: '#fff', minHeight: '100vh', fontFamily: 'Impact, sans-serif' }}>
      <h1 style={{ fontSize: '48px', textAlign: 'center', background: 'linear-gradient(90deg, #00f0ff, #ff00aa)', WebkitBackgroundClip: 'text', color: 'transparent' }}>
        🏖️ VIBEMESH v1.4 — SHORE LIVE 🔥
      </h1>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '30px', marginTop: '30px' }}>
        {/* LIVE RENDERERS */}
        <div style={{ textAlign: 'center' }}>
          <VibeAvatarRenderer tier={negotiated?.agreedRenderTier ?? Tier.TEXT} state={lastState} />
          <Vibe3DRenderer tier={negotiated?.agreedRenderTier ?? Tier.TEXT} state={lastState} buildProgress={localProfile.batteryLevel / 100} />
          <VoiceClonePanel state={lastState} />
        </div>

        {/* CONTROLS */}
        <div>
          <h3>📡 Local Hardware</h3>
          Bandwidth: {localProfile.estimatedBandwidthKbps} kbps
          <input type="range" min="5" max="900" value={localProfile.estimatedBandwidthKbps} 
            onChange={e => setLocalProfile(p => ({...p, estimatedBandwidthKbps: +e.target.value}))} style={{width:'100%'}} />

          Battery: {localProfile.batteryLevel}%
          <input type="range" min="1" max="100" value={localProfile.batteryLevel} 
            onChange={e => setLocalProfile(p => ({...p, batteryLevel: +e.target.value}))} style={{width:'100%'}} />

          <label>
            <input type="checkbox" checked={localProfile.lowDataMode} 
              onChange={e => setLocalProfile(p => ({...p, lowDataMode: e.target.checked}))} /> Low Data Mode
          </label>

          <button onClick={handleSend} 
            style={{ width: '100%', padding: '18px', fontSize: '24px', marginTop: '20px', background: 'linear-gradient(#ff00aa, #00f0ff)', border: 'none', borderRadius: '12px', color: '#000', cursor: 'pointer' }}>
            👊 SEND FIST PUMP
          </button>

          <label style={{ display: 'block', marginTop: '15px' }}>
            <input type="checkbox" checked={autoSend} onChange={e => setAutoSend(e.target.checked)} /> Auto-send demo
          </label>

          <div style={{ marginTop: '30px', background: '#111', padding: '15px', borderRadius: '10px' }}>
            Tier: <strong style={{color: '#00f0ff'}}>{currentTierName}</strong><br/>
            Packets sent: <strong>{sent}</strong><br/>
            Est. packet size: <strong style={{color: packetBytes < 100 ? '#00ff88' : '#ffaa00'}}>{packetBytes} bytes</strong><br/>
            Transport: <strong style={{color: transport.isConnected ? '#00ff88' : '#ff4757'}}>{transport.isConnected ? 'CONNECTED' : 'DISCONNECTED'}</strong>
          </div>
        </div>
      </div>
    </div>
  );
};