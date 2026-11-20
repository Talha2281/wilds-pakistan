import { useEffect, useRef } from 'react';
import { WildScene } from '../game/WildScene';
import { GameSimulation } from '../sim/worldSim';
import { BiomeId } from '../types/game';

interface LandingFlythroughProps {
  biomeId?: BiomeId;
}

export function LandingFlythrough({ biomeId = 'northern_mountains' }: LandingFlythroughProps) {
  const mountRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const sim = new GameSimulation({
      mode: 'wild_life',
      animalId: 'snow_leopard',
      biomeId,
      season: 'summer',
      weather: 'clear',
      seed: 202611,
      startPlaying: true,
    });

    const scene = new WildScene(
      container,
      sim,
      {
        onSnapshot: () => {},
        onEvents: () => {},
      },
      true,
    );

    return () => {
      scene.dispose();
    };
  }, [biomeId]);

  return (
    <div
      ref={mountRef}
      aria-hidden="true"
      className="fixed inset-0 z-0 h-full w-full pointer-events-none"
    />
  );
}
