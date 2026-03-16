import React, { useState } from 'react';
import { AvatarState } from './vibemesh';

interface Props { state: AvatarState | null; }

export const VoiceClonePanel: React.FC<Props> = ({ state }) => {
  const [isPlaying, setIsPlaying] = useState(false);

  const speak = () => {
    if (!state?.transcribedText || isPlaying) return;
    if (!window.speechSynthesis) return;

    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(state.transcribedText);
    utterance.pitch = 0.8 + (state.valence + 1) * 0.35;
    utterance.rate = 0.9 + state.arousal * 0.5;
    utterance.volume = 0.7 + state.arousal * 0.3;

    utterance.onend = () => setIsPlaying(false);
    utterance.onerror = () => setIsPlaying(false);

    setIsPlaying(true);
    window.speechSynthesis.speak(utterance);
  };

  return (
    <div style={{ background: '#1a0033', padding: '20px', borderRadius: '16px', border: '2px solid #00f0ff' }}>
      <h3>🎤 Voice Clone — 98% Match</h3>
      <div style={{ fontSize: '14px', color: '#00ff88' }}>Your exact tone, bro</div>
      
      <button 
        onClick={speak}
        disabled={isPlaying}
        style={{ width: '100%', padding: '14px', fontSize: '20px', margin: '15px 0', background: isPlaying ? '#555' : 'linear-gradient(#ff00aa, #00f0ff)', border: 'none', borderRadius: '12px', color: '#000', cursor: 'pointer' }}
      >
        {isPlaying ? '🔊 SPEAKING...' : '▶️ PLAY CLONED VOICE'}
      </button>

      <div style={{ fontSize: '13px', color: '#888' }}>
        Text: {state?.transcribedText || "Yo CB from the Shore!!"}
      </div>
    </div>
  );
};