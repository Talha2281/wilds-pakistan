import { useEffect, useState } from 'react';
import { AuthModal } from './components/AuthModal';
import { OfflineIndicator } from './components/OfflineIndicator';
import { AuthAccount, loadActiveAccount } from './data/auth';
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

  const [account, setAccount] = useState<AuthAccount | null>(() => loadActiveAccount());
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [authPrompt, setAuthPrompt] = useState('');
  const [pendingNav, setPendingNav] = useState<{
    mode?: GameMode;
    opts?: { daily?: boolean };
  } | null>(null);

  useEffect(() => {
    const onPop = () => {
      setOnGame(isGameRoute(window.location.pathname));
      setPresetMode(getInitialPresetMode());
      setPresetDaily(getInitialDailyFlag());
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const performNavigateToGame = (mode?: GameMode, opts?: { daily?: boolean }) => {
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

  const requestNavigateToGame = (mode?: GameMode, opts?: { daily?: boolean }) => {
    if (!account) {
      setPendingNav({ mode, opts });
      setAuthPrompt(
        'Please sign in or create your free Ranger account to enter the wilderness and save your XP.',
      );
      setShowAuthModal(true);
      return;
    }
    performNavigateToGame(mode, opts);
  };

  const navigateToHome = () => {
    const homeUrl = window.location.pathname.replace(/\/game\/?(index\.html)?$/i, '/');
    window.history.pushState({}, '', homeUrl || '/');
    setOnGame(false);
    setPendingNav(null);
    window.scrollTo(0, 0);
  };

  const handleAuthChange = (next: AuthAccount | null) => {
    setAccount(next);
    if (next) {
      setShowAuthModal(false);
      setAuthPrompt('');
      if (pendingNav) {
        const target = pendingNav;
        setPendingNav(null);
        performNavigateToGame(target.mode, target.opts);
      }
    }
  };

  const openAuthModal = () => {
    setPendingNav(null);
    setAuthPrompt('');
    setShowAuthModal(true);
  };

  return (
    <>
      {onGame ? (
        account ? (
          <GamePage
            account={account}
            onOpenAuth={openAuthModal}
            initialMode={presetMode}
            initialDaily={presetDaily}
            onNavigateHome={navigateToHome}
          />
        ) : (
          <div className="min-h-screen bg-slate-950 text-slate-100">
            <AuthModal
              account={null}
              allowClose={false}
              promptMessage="Authentication required: please sign in or create a free Ranger account before entering the wilderness."
              onNavigateHome={navigateToHome}
              onAuthChange={handleAuthChange}
              onClose={() => {}}
            />
          </div>
        )
      ) : (
        <LandingPage
          account={account}
          onOpenAuth={openAuthModal}
          onNavigateGame={requestNavigateToGame}
        />
      )}

      {showAuthModal && !(onGame && !account) && (
        <AuthModal
          account={account}
          promptMessage={authPrompt || undefined}
          allowClose
          onAuthChange={handleAuthChange}
          onClose={() => {
            setShowAuthModal(false);
            setPendingNav(null);
            setAuthPrompt('');
          }}
        />
      )}

      <OfflineIndicator lang={lang} />
    </>
  );
}
