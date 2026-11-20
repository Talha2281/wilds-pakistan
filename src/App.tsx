import { useEffect, useState } from 'react';
import { OfflineIndicator } from './components/OfflineIndicator';
import { useLanguage } from './data/i18n';
import { GamePage } from './pages/GamePage';
import { LandingPage } from './pages/LandingPage';
import { GameMode } from './types/game';

function isGameRoute(pathname: string): boolean {
  return /\/game\/?(index\.html)?$/i.test(pathname);
}

function getInitialPresetMode(): GameMode {
  try {
    const params = new URLSearchParams(window.location.search);
    const m = params.get('mode');
    if (m === 'wild_life' || m === 'ranger_patrol' || m === 'photo_safari') return m;
  } catch {
    // ignore
  }
  return 'wild_life';
}

function getInitialDailyFlag(): boolean {
  try {
    const params = new URLSearchParams(window.location.search);
    return params.get('daily') === '1';
  } catch {
    return false;
  }
}

export default function App() {
  const [lang] = useLanguage();
  const [onGame, setOnGame] = useState<boolean>(() => isGameRoute(window.location.pathname));
  const [presetMode, setPresetMode] = useState<GameMode>(() => getInitialPresetMode());
  const [presetDaily, setPresetDaily] = useState<boolean>(() => getInitialDailyFlag());

  useEffect(() => {
    const onPop = () => {
      setOnGame(isGameRoute(window.location.pathname));
      setPresetMode(getInitialPresetMode());
      setPresetDaily(getInitialDailyFlag());
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const navigateToGame = (mode?: GameMode, opts?: { daily?: boolean }) => {
    const chosenMode = mode ?? 'wild_life';
    const isDaily = Boolean(opts?.daily);
    setPresetMode(chosenMode);
    setPresetDaily(isDaily);
    const base = window.location.pathname.replace(/\/(index\.html)?$/i, '/');
    const qs = new URLSearchParams();
    if (mode) qs.set('mode', mode);
    if (isDaily) qs.set('daily', '1');
    const queryStr = qs.toString();
    const gameUrl = `${base.endsWith('/game/') ? base : `${base}game/`}${
      queryStr ? `?${queryStr}` : ''
    }`;
    window.history.pushState({}, '', gameUrl);
    setOnGame(true);
    window.scrollTo(0, 0);
  };

  const navigateToHome = () => {
    const homeUrl = window.location.pathname.replace(/\/game\/?(index\.html)?$/i, '/');
    window.history.pushState({}, '', homeUrl || '/');
    setOnGame(false);
    window.scrollTo(0, 0);
  };

  return (
    <>
      {onGame ? (
        <GamePage
          initialMode={presetMode}
          initialDaily={presetDaily}
          onNavigateHome={navigateToHome}
        />
      ) : (
        <LandingPage onNavigateGame={navigateToGame} />
      )}
      <OfflineIndicator lang={lang} />
    </>
  );
}
