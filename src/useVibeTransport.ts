// src/useVibeTransport.ts - WebRTC DataChannel Transport v1.0
// SHORE CERTIFIED • Low-bit only • Works with your v1.4

import { useState, useEffect, useRef, useCallback } from 'react';
import { VibePacket } from './vibemesh';

export const useVibeTransport = (sessionId: string = "shore-live") => {
  const [isConnected, setIsConnected] = useState(false);
  const [remoteAvatarState, setRemoteAvatarState] = useState<any>(null);
  const [packetsReceived, setPacketsReceived] = useState(0);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);

  const createPeerConnection = useCallback(async (isOfferer: boolean) => {
    const pc = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
    });
    pcRef.current = pc;

    const dc = isOfferer 
      ? pc.createDataChannel('vibemesh', { ordered: true })
      : null;

    if (dc) dcRef.current = dc;

    pc.ondatachannel = (event) => {
      dcRef.current = event.channel;
      setupDataChannel(event.channel);
    };

    const setupDataChannel = (channel: RTCDataChannel) => {
      channel.onopen = () => setIsConnected(true);
      channel.onclose = () => setIsConnected(false);
      channel.onmessage = (e) => {
        try {
          const packet: VibePacket = JSON.parse(e.data);
          if (packet.type === "avatar") {
            setRemoteAvatarState(packet.avatarState);
            setPacketsReceived(p => p + 1);
          }
        } catch (_) {}
      };
    };

    if (isOfferer && dc) setupDataChannel(dc);

    pc.onicecandidate = (e) => {
      if (e.candidate) console.log('%cICE CANDIDATE (copy to other tab):', 'color:cyan', e.candidate);
    };

    if (isOfferer) {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      console.log('%c=== COPY THIS OFFER TO ANSWERER TAB ===', 'color:#ff00aa;font-size:16px');
      console.dir(offer);
    }

    return pc;
  }, []);

  const sendPacket = useCallback((packet: VibePacket) => {
    if (dcRef.current?.readyState === 'open') {
      dcRef.current.send(JSON.stringify(packet));
    }
  }, []);

  const handleRemoteOffer = useCallback(async (offerStr: string) => {
    const offer = JSON.parse(offerStr);
    const pc = pcRef.current || await createPeerConnection(false);
    await pc.setRemoteDescription(offer);
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    console.log('%c=== COPY THIS ANSWER BACK TO OFFERER TAB ===', 'color:#00f0ff;font-size:16px');
    console.dir(answer);
  }, []);

  const handleRemoteAnswer = useCallback(async (answerStr: string) => {
    const answer = JSON.parse(answerStr);
    if (pcRef.current) await pcRef.current.setRemoteDescription(answer);
  }, []);

  return {
    isConnected,
    remoteAvatarState,
    packetsReceived,
    sendPacket,
    createOffer: () => createPeerConnection(true),
    handleRemoteOffer,
    handleRemoteAnswer,
  };
};
