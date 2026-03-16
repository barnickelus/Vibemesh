import React, { useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, Sphere } from '@react-three/drei';
import * as THREE from 'three';
import { Tier, AvatarState } from './vibemesh';

interface Props { tier: Tier; state: AvatarState | null; buildProgress: number; }

function HeadModel({ state, buildProgress }: { state: AvatarState | null; buildProgress: number }) {
  const headRef = useRef<THREE.Group>(null!);
  const eyeRef = useRef<THREE.Group>(null!);

  useFrame(() => {
    if (headRef.current && state?.headRotation) {
      headRef.current.rotation.y = state.headRotation.y * 1.2;
      headRef.current.rotation.x = state.headRotation.x * 0.8;
    }
    if (eyeRef.current && state?.blendshapes) {
      const smile = state.blendshapes.smile || 0;
      eyeRef.current.scale.y = 1 - smile * 0.3;
    }
  });

  return (
    <group ref={headRef}>
      <Sphere args={[1.2]} position={[0, 0, 0]}>
        <meshStandardMaterial color={`hsl(30, 80%, ${50 + buildProgress * 50}%)`} metalness={0.6} roughness={0.3} />
      </Sphere>
      <group ref={eyeRef} position={[0, 0.4, 1.1]}>
        <Sphere args={[0.3]} position={[-0.6, 0, 0]}>
          <meshStandardMaterial color="#000" />
        </Sphere>
        <Sphere args={[0.3]} position={[0.6, 0, 0]}>
          <meshStandardMaterial color="#000" />
        </Sphere>
      </group>
      {state?.gestures.includes(4) && (
        <mesh position={[0, 0.5, 1.4]}>
          <boxGeometry args={[2.2, 0.3, 0.1]} />
          <meshStandardMaterial color="#111" />
        </mesh>
      )}
    </group>
  );
}

export const Vibe3DRenderer: React.FC<Props> = ({ tier, state, buildProgress }) => {
  if (tier < Tier.AVATAR3D) return null;

  return (
    <div style={{ width: '320px', height: '320px', borderRadius: '20px', overflow: 'hidden', background: '#000', position: 'relative' }}>
      <Canvas camera={{ position: [0, 0, 5] }}>
        <ambientLight intensity={0.6} />
        <pointLight position={[10, 10, 10]} />
        <HeadModel state={state} buildProgress={buildProgress} />
        <OrbitControls enablePan={false} enableZoom={false} />
      </Canvas>
      <div style={{ position: 'absolute', bottom: '10px', left: '10px', color: '#00ffcc', fontSize: '14px' }}>
        3D BEAST — Build {Math.floor(buildProgress * 100)}%
      </div>
    </div>
  );
};