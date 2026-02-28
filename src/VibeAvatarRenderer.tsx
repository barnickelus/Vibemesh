import React from 'react';
import { Tier, AvatarState } from './vibemesh';

interface VibeAvatarRendererProps {
  tier: Tier;
  state: AvatarState | null;
}

export const VibeAvatarRenderer: React.FC<VibeAvatarRendererProps> = ({ tier, state }) => {
  const isFist = state?.gestures.includes(4);

  switch (tier) {
    case Tier.TEXT:
      return <div style={{ fontSize: '52px' }}>💬 {state?.transcribedText || "Yo CB what's good?!"}</div>;

    case Tier.GLYPH:
      return <div style={{ fontSize: '110px' }}>{isFist ? '👊🔥😂' : '😎👀💦'}</div>;

    case Tier.SPRITE:
      return <div style={{ fontSize: '150px' }}>🕺</div>;

    case Tier.PUPPET:
      return (
        <div style={{ width: '200px', height: '220px', background: '#222', borderRadius: '50% 50% 40% 40%', position: 'relative', overflow: 'hidden' }}>
          <div style={{ position: 'absolute', top: '40%', left: '35%', fontSize: '80px', transform: `rotate(${state?.headRotation?.y ? state.headRotation.y * 30 : 0}deg)` }}>
            😎
          </div>
          <div style={{ position: 'absolute', bottom: '20%', left: '50%', transform: 'translateX(-50%)', fontSize: '60px' }}>{isFist ? '👊' : '😎'}</div>
        </div>
      );

    case Tier.AVATAR3D:
    default:
      return (
        <div style={{ width: '260px', height: '260px', background: 'linear-gradient(45deg, #ff00aa, #00f0ff)', borderRadius: '30px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '140px', boxShadow: '0 0 60px #ff00aa' }}>
          🦾 {isFist ? '👊' : '😎'}
        </div>
      );
  }
};
