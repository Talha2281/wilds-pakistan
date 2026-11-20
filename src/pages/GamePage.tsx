import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Binoculars,
  BookOpen,
  Box,
  Calendar,
  Camera,
  Compass,
  Crosshair,
  Droplets,
  Flame,
  Globe,
  History,
  Home,
  Lock,
  Navigation,
  Pause,
  Play,
  RotateCcw,
  Shield,
  ShieldCheck,
  Sparkles,
  Trophy,
  Users,
  Utensils,
  Volume2,
  VolumeX,
  Wind,
  Zap,
  ZoomIn,
  MessageSquarePlus,
  UserCheck,
  UserCircle2,
} from 'lucide-react';
import { soundEngine } from '../audio/soundEngine';
import { AuthModal } from '../components/AuthModal';
import { CustomGlbModal } from '../components/CustomGlbModal';
import { FeedbackModal } from '../components/FeedbackModal';
import { FieldGuideModal } from '../components/FieldGuideModal';
import { MarkhorHillsLogo } from '../components/MarkhorHillsLogo';
import { PhotoAlbumModal } from '../components/PhotoAlbumModal';
import { PWAInstallButton } from '../components/PWAInstallButton';
import { RecordsModal } from '../components/RecordsModal';
import { TouchControls } from '../components/TouchControls';
import { TutorialOverlay } from '../components/TutorialOverlay';
import { ALL_CHARACTERS, ANIMALS, FIELD_GUIDE_SPECIES, SPECIES_RARITY_META } from '../data/animals';
import {
  AuthAccount,
  loadActiveAccount,
  syncCurrentAccountXp,
} from '../data/auth';
import { subscribeGoogleAuth } from '../data/googleAuthSheets';
import { BIOMES, BIOME_LIST } from '../data/biomes';
import { getConservationEnding, loadConservationMap } from '../data/conservation';
import { getDailyExpedition, getWeeklyChallenge } from '../data/dailyExpedition';
import { COPY, useLanguage } from '../data/i18n';
import { loadSavedPhotos, saveCapturedPhoto } from '../data/photos';
import {
  addProgressionXp,
  equipSkin,
  getEquippedSkin,
  getLevelFromXp,
  isAnimalUnlocked,
  isSkinUnlocked,
  loadProgression,
  markTutorialCompleted,
  recordDailyCompletion,
  updateWeeklyProgress,
} from '../data/progression';
import {
  MODE_LABELS,
  SaveRecordResult,
  buildRecordSummary,
  createRecordId,
  formatDuration,
  getLastPlayerName,
  loadLocalRecords,
  submitSharedRecord,
  setLastPlayerName,
} from '../data/records';
import { WildScene } from '../game/WildScene';
import { CoopClient, CoopTransportKind } from '../sim/coopClient';
import { GameSimulation } from '../sim/worldSim';
import {
  AnimalId,
  BiomeId,
  CoopPeerState,
  CoopSquadMode,
  GameMode,
  NpcSpeciesId,
  PlayerRecord,
  RangerToolId,
  SavedPhotoEntry,
  SeasonId,
  SimEvent,
  SimSnapshot,
  WeatherId,
} from '../types/game';

interface GamePageProps {
  initialMode?: GameMode;
  initialDaily?: boolean;
  onNavigateHome: () => void;
}

function pushAnalyticsEvent(name: string, payload: Record<string, unknown>) {
  const w = window as unknown as { dataLayer?: Array<Record<string, unknown>> };
  if (Array.isArray(w.dataLayer)) {
    w.dataLayer.push({ event: name, ...payload });
  }
}

export function GamePage({
  initialMode = 'wild_life',
  initialDaily = false,
  onNavigateHome,
}: GamePageProps) {
  const [lang, setLang] = useLanguage();
  const t = COPY[lang];
  const daily = useMemo(() => getDailyExpedition(), []);

  const [screen, setScreen] = useState<'setup' | 'playing'>('setup');
  const [playerName, setPlayerName] = useState<string>(() => getLastPlayerName());
  const [nameError, setNameError] = useState('');

  const [isDailyMode, setIsDailyMode] = useState<boolean>(initialDaily);
  const [mode, setMode] = useState<GameMode>(initialDaily ? daily.mode : initialMode);
  const [animalId, setAnimalId] = useState<AnimalId>(
    initialDaily
      ? daily.animalId
      : initialMode === 'wild_life'
        ? 'snow_leopard'
        : 'ranger',
  );
  const [biomeId, setBiomeId] = useState<BiomeId>(
    initialDaily ? daily.biomeId : 'northern_mountains',
  );
  const [season, setSeason] = useState<SeasonId>(initialDaily ? daily.season : 'summer');
  const [weather, setWeather] = useState<WeatherId>(
    BIOMES[initialDaily ? daily.biomeId : 'northern_mountains'].defaultWeather,
  );
  const [round, setRound] = useState(1);
  const [carryScore, setCarryScore] = useState(0);
  const [carryRunXp, setCarryRunXp] = useState(0);
  const [runKey, setRunKey] = useState(0);

  // Progression & Skins
  const [prog, setProg] = useState(() => loadProgression());
  const levelInfo = useMemo(() => getLevelFromXp(prog.xp), [prog.xp]);
  const conservationMap = useMemo(() => loadConservationMap(), [screen, runKey]);

  // Co-op Squad State
  const [coopEnabled, setCoopEnabled] = useState(false);
  const [coopSquadMode, setCoopSquadMode] = useState<CoopSquadMode>('rangers');
  const [coopRoomCode, setCoopRoomCode] = useState('PK-ALPHA');
  const [coopSeedOverride, setCoopSeedOverride] = useState<number | undefined>(undefined);
  const [coopPeers, setCoopPeers] = useState<CoopPeerState[]>([]);
  const [coopTransport, setCoopTransport] = useState<CoopTransportKind>('offline');
  const [coopToast, setCoopToast] = useState('');

  // Account & Post-Game Feedback State
  const [account, setAccount] = useState<AuthAccount | null>(() => loadActiveAccount());
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [showFeedbackModal, setShowFeedbackModal] = useState(false);

  // Audio, Modals & Tutorial
  const [muted, setMuted] = useState(false);
  const [showRecords, setShowRecords] = useState(false);
  const [showFieldGuide, setShowFieldGuide] = useState(false);
  const [showGlbModal, setShowGlbModal] = useState(false);
  const [showAlbum, setShowAlbum] = useState(false);
  const [showTutorial, setShowTutorial] = useState(() => !loadProgression().tutorialCompleted);
  const [records, setRecords] = useState<PlayerRecord[]>(() => loadLocalRecords());
  const [savedPhotos, setSavedPhotos] = useState<SavedPhotoEntry[]>(() => loadSavedPhotos());
  const [shutterFlash, setShutterFlash] = useState(false);
  const [lastSaveStatus, setLastSaveStatus] = useState<SaveRecordResult | null>(null);

  const [snapshot, setSnapshot] = useState<SimSnapshot | null>(null);

  const canvasMountRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<WildScene | null>(null);
  const simRef = useRef<GameSimulation | null>(null);
  const coopRef = useRef<CoopClient | null>(null);
  const recordSavedRef = useRef(false);
  const feedbackPromptedRunRef = useRef(false);
  // Guarantees every non-Daily restart spawns at a unique random coordinate!
  const previousSpawnsRef = useRef<Array<{ x: number; z: number }>>([]);

  useEffect(() => {
    const unsub = subscribeGoogleAuth(() => {});
    return unsub;
  }, []);

  useEffect(() => {
    if (account?.rangerName && !playerName.trim()) {
      setPlayerName(account.rangerName);
    }
  }, [account, playerName]);

  useEffect(() => {
    if (initialDaily) {
      setIsDailyMode(true);
      setMode(daily.mode);
      setAnimalId(daily.animalId);
      setBiomeId(daily.biomeId);
      setSeason(daily.season);
      setWeather(BIOMES[daily.biomeId].defaultWeather);
    }
  }, [initialDaily, daily]);

  const handleToggleDaily = (enabled: boolean) => {
    setIsDailyMode(enabled);
    if (enabled) {
      setCoopEnabled(false);
      setMode(daily.mode);
      setAnimalId(daily.animalId);
      setBiomeId(daily.biomeId);
      setSeason(daily.season);
      setWeather(BIOMES[daily.biomeId].defaultWeather);
    }
  };

  const handleSelectMode = (nextMode: GameMode) => {
    setIsDailyMode(false);
    setMode(nextMode);
    if (nextMode === 'ranger_patrol' || nextMode === 'photo_safari') {
      setAnimalId('ranger');
    } else if (animalId === 'ranger') {
      setAnimalId('markhor');
      setBiomeId(ANIMALS.markhor.homeBiome);
      setWeather(BIOMES[ANIMALS.markhor.homeBiome].defaultWeather);
    }
  };

  const handleSelectAnimal = (nextAnimal: AnimalId) => {
    if (!isAnimalUnlocked(nextAnimal, prog.xp, isDailyMode ? daily.animalId : undefined)) return;
    setAnimalId(nextAnimal);
    const home = ANIMALS[nextAnimal].homeBiome;
    setBiomeId(home);
    setWeather(BIOMES[home].defaultWeather);
  };

  const handleSelectBiome = (nextBiome: BiomeId) => {
    setBiomeId(nextBiome);
    setWeather(BIOMES[nextBiome].defaultWeather);
  };

  const handleSelectCoopSquad = (enabled: boolean, squad: CoopSquadMode) => {
    setCoopEnabled(enabled);
    setCoopSquadMode(squad);
    if (enabled) {
      setIsDailyMode(false);
      if (squad === 'rangers') {
        setMode('ranger_patrol');
        setAnimalId('ranger');
      } else {
        setMode('wild_life');
        if (animalId === 'ranger') {
          setAnimalId('snow_leopard');
          setBiomeId('northern_mountains');
        }
      }
    }
  };

  const persistRunRecord = useCallback(
    (snap: SimSnapshot, victory: boolean) => {
      if (recordSavedRef.current) return;
      recordSavedRef.current = true;

      // Persistent Progression XP + Daily/Weekly Updates
      const runBonus = victory ? 120 : 25;
      const nextProg = addProgressionXp(snap.xpEarned + runBonus);
      setProg(nextProg);
      void syncCurrentAccountXp(nextProg.xp);

      if (victory && snap.isDailyExpedition) {
        setProg(recordDailyCompletion(daily.dateKey));
      }

      setProg(
        updateWeeklyProgress(
          {
            orbs: snap.orbsCollected,
            arrests: snap.poachersArrested,
            photos: snap.photosTaken,
            runs: 1,
          },
          getWeeklyChallenge(),
        ),
      );

      const summary = buildRecordSummary({ ...snap, round: snap.round });
      const rec: PlayerRecord = {
        id: createRecordId(),
        playerName: playerName.trim() || 'Anonymous Ranger',
        round: snap.round,
        mode: snap.mode,
        animalId: snap.animalId,
        biomeId: snap.biomeId,
        score: snap.score,
        elapsedSec: snap.elapsedSec,
        victory,
        seed: snap.seed,
        timestamp: Date.now(),
        summary,
        isDaily: snap.isDailyExpedition,
        conservationScore: snap.conservationScore,
        growthStage: snap.growthStage,
      };
      void submitSharedRecord(rec).then((res) => {
        setLastSaveStatus(res);
      });
      setRecords(loadLocalRecords());
      pushAnalyticsEvent(victory ? 'game_victory' : 'game_over', {
        mode: snap.mode,
        animal: snap.animalId,
        biome: snap.biomeId,
        round: snap.round,
        score: snap.score,
        isDaily: snap.isDailyExpedition,
        conservationScore: snap.conservationScore,
      });
    },
    [playerName, daily.dateKey],
  );

  const handleEvents = useCallback(
    (events: SimEvent[]) => {
      for (const ev of events) {
        if (ev.type === 'orb_collected') {
          soundEngine.playSfx('orb');
          coopRef.current?.sendCoopEvent(playerName || 'Teammate', 'orb_collected', 'Spirit Orb');
        } else if (ev.type === 'jaal_cleared') soundEngine.playSfx('jaal_clear');
        else if (ev.type === 'jaal_hit' || ev.type === 'shikari_shot') soundEngine.playSfx('danger');
        else if (ev.type === 'player_hurt') soundEngine.playSfx('hurt');
        else if (ev.type === 'horn_counter')
          soundEngine.playSpeciesActionTrigger(animalId, 'horn_counter');
        else if (ev.type === 'growth_up') soundEngine.playSfx('growth');
        else if (ev.type === 'jump_leap')
          soundEngine.playSpeciesActionTrigger(animalId, 'jump');
        else if (ev.type === 'pounce_launch')
          soundEngine.playSpeciesActionTrigger(animalId, 'pounce');
        else if (ev.type === 'threat_stunned')
          soundEngine.playSpeciesActionTrigger(animalId, 'threat_stunned');
        else if (ev.type === 'dive_toggle')
          soundEngine.playSpeciesActionTrigger(animalId, 'dive');
        else if (ev.type === 'hunt_catch') soundEngine.playSfx('hunt');
        else if (ev.type === 'eat_forage') soundEngine.playSfx('forage');
        else if (ev.type === 'dart_fired') soundEngine.playSfx('dart');
        else if (ev.type === 'poacher_sedated' || ev.type === 'poacher_arrested') {
          soundEngine.playSfx('arrest');
          if (ev.type === 'poacher_arrested') {
            coopRef.current?.sendCoopEvent(
              playerName || 'Teammate',
              'poacher_arrested',
              ev.label || 'Poacher',
            );
          }
        } else if (ev.type === 'animal_rescued') soundEngine.playSfx('rescue');
        else if (ev.type === 'snare_cleared') soundEngine.playSfx('snare');
        else if (ev.type === 'tool_switched') soundEngine.playSfx('tool_switch');
        else if (ev.type === 'binoculars_scout') soundEngine.playSfx('scout_ping');
        else if (ev.type === 'swim_enter' || ev.type === 'swim_exit') soundEngine.playSfx('splash');
        else if (ev.type === 'animal_call') soundEngine.playAnimalCall(animalId, mode);
        else if (ev.type === 'nearby_animal_call' && ev.speciesId) {
          soundEngine.playSpeciesSound(ev.speciesId as NpcSpeciesId, ev.distance ?? 18);
        }
        else if (ev.type === 'photo_captured') {
          soundEngine.playSfx('shutter');
          setShutterFlash(true);
          window.setTimeout(() => setShutterFlash(false), 180);

          if (sceneRef.current && ev.speciesId) {
            try {
              const dataUrl = sceneRef.current.captureSnapshotDataUrl();
              const spId = ev.speciesId as NpcSpeciesId;
              const spInfo = FIELD_GUIDE_SPECIES[spId];
              const entry: SavedPhotoEntry = {
                id: `photo-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                speciesId: spId,
                speciesName: spInfo?.name ?? ev.label ?? spId,
                scientificName: spInfo?.scientificName ?? 'Wildlife of Pakistan',
                biomeId,
                biomeName: BIOMES[biomeId].name,
                rangerName: playerName.trim() || 'Ranger',
                dataUrl,
                timestamp: Date.now(),
                rarity: ev.rarity ?? spInfo?.rarity,
                qualityGrade: ev.qualityGrade,
                photoScore: ev.photoScore,
                actionTag: ev.actionTag,
              };
              setSavedPhotos(saveCapturedPhoto(entry));
            } catch {
              // Ignore WebGL readback failure
            }
          }
        } else if (ev.type === 'victory') {
          soundEngine.playSfx('victory');
          if (simRef.current) persistRunRecord(simRef.current.getSnapshot(), true);
          if (!feedbackPromptedRunRef.current) {
            feedbackPromptedRunRef.current = true;
            window.setTimeout(() => setShowFeedbackModal(true), 1200);
          }
        } else if (ev.type === 'game_over') {
          if (simRef.current) persistRunRecord(simRef.current.getSnapshot(), false);
          if (!feedbackPromptedRunRef.current) {
            feedbackPromptedRunRef.current = true;
            window.setTimeout(() => setShowFeedbackModal(true), 1200);
          }
        }
      }
    },
    [animalId, biomeId, mode, playerName, persistRunRecord],
  );

  // Main 3D Simulation + Scene Lifecycle
  useEffect(() => {
    if (screen !== 'playing') return;
    const container = canvasMountRef.current;
    if (!container) return;

    recordSavedRef.current = false;
    feedbackPromptedRunRef.current = false;
    setShowFeedbackModal(false);
    setLastSaveStatus(null);
    const currentProg = loadProgression();
    const equippedSkin = getEquippedSkin(animalId, currentProg);

    const sim = new GameSimulation({
      mode,
      animalId,
      biomeId,
      season,
      weather,
      seed: isDailyMode ? daily.seed : coopEnabled ? coopSeedOverride : undefined,
      round,
      initialScore: carryScore,
      initialRunXp: carryRunXp,
      startPlaying: false,
      isDailyExpedition: isDailyMode,
      previousSpawns: isDailyMode ? [] : previousSpawnsRef.current,
    });

    if (!isDailyMode) {
      previousSpawnsRef.current = [
        { x: sim.playerX, z: sim.playerZ },
        ...previousSpawnsRef.current,
      ].slice(0, 12);
    }

    simRef.current = sim;
    setSnapshot(sim.getSnapshot());

    const scene = new WildScene(
      container,
      sim,
      {
        onSnapshot: (snap) => {
          setSnapshot(snap);
          soundEngine.updateDynamicEnvironment({
            distanceToWater: snap.distanceToWater,
            elevation: snap.elevation,
            isSwimming: snap.isSwimming,
            isDiving: snap.isDiving,
            speed: snap.playerSpeed,
            weather: snap.weather,
          });
        },
        onEvents: (evs) => handleEvents(evs),
      },
      false,
      equippedSkin,
    );
    sceneRef.current = scene;

    // Connect Co-op Client if enabled
    let coopSyncTimer: number | null = null;
    if (coopEnabled) {
      const client = new CoopClient({
        onPeersChange: (peers, transport) => {
          setCoopPeers(peers);
          setCoopTransport(transport);
          scene.syncCoopPeers(peers);
        },
        onWelcome: (welcome) => {
          if (welcome.seed && welcome.seed !== coopSeedOverride) {
            setCoopSeedOverride(welcome.seed);
          }
        },
        onCoopEvent: (ev) => {
          setCoopToast(`${ev.playerName}: ${ev.label || ev.eventType}!`);
          window.setTimeout(() => setCoopToast(''), 3000);
        },
      });
      coopRef.current = client;
      client.joinRoom({
        roomCode: coopRoomCode,
        squadMode: coopSquadMode,
        playerName: playerName.trim() || 'Ranger',
        animalId,
        skinId: equippedSkin.id,
        biomeId,
        mode,
        seed: sim.seed,
      });

      coopSyncTimer = window.setInterval(() => {
        if (!simRef.current) return;
        client.sendState({
          playerName: playerName.trim() || 'Ranger',
          animalId: simRef.current.animalId,
          skinId: equippedSkin.id,
          x: simRef.current.playerX,
          y: simRef.current.playerY,
          z: simRef.current.playerZ,
          heading: simRef.current.playerHeading,
          gait: simRef.current.playerGait,
          growthStage: simRef.current.growthStage,
        });
      }, 110);
    }

    soundEngine.startSessionAudio(mode, biomeId);

    const onEsc = (e: KeyboardEvent) => {
      if (e.code === 'Escape') {
        sim.togglePause();
        setSnapshot(sim.getSnapshot());
      } else if (e.code === 'Enter' && sim.phase === 'intro') {
        sim.startFromIntro();
        setSnapshot(sim.getSnapshot());
      }
    };
    window.addEventListener('keydown', onEsc);

    return () => {
      window.removeEventListener('keydown', onEsc);
      if (coopSyncTimer !== null) window.clearInterval(coopSyncTimer);
      coopRef.current?.disconnect();
      coopRef.current = null;
      setCoopPeers([]);
      soundEngine.stopSessionAudio();
      scene.dispose();
      sceneRef.current = null;
      simRef.current = null;
    };
  }, [
    screen,
    mode,
    animalId,
    biomeId,
    season,
    weather,
    round,
    carryScore,
    carryRunXp,
    runKey,
    isDailyMode,
    daily.seed,
    coopEnabled,
    coopRoomCode,
    coopSquadMode,
    coopSeedOverride,
    playerName,
    handleEvents,
  ]);

  const handleLaunchRun = (e?: React.FormEvent) => {
    e?.preventDefault();
    const cleaned = playerName.trim();
    if (!cleaned) {
      setNameError(
        lang === 'ur'
          ? 'مہم شروع کرنے سے پہلے براہِ کرم اپنا نام لکھیں۔'
          : 'Please enter your ranger name before starting this expedition.',
      );
      return;
    }
    setNameError('');
    setLastPlayerName(cleaned);
    soundEngine.prewarm();
    pushAnalyticsEvent('game_start', {
      mode,
      animal: animalId,
      biome: biomeId,
      isDaily: isDailyMode,
      coop: coopEnabled,
    });
    setRound(1);
    setCarryScore(0);
    setCarryRunXp(0);
    setRunKey((k) => k + 1);
    setScreen('playing');
  };

  const handleRestart = () => {
    if (simRef.current && simRef.current.elapsedSec > 8 && !recordSavedRef.current) {
      persistRunRecord(simRef.current.getSnapshot(), false);
    }
    setRound(1);
    setCarryScore(0);
    setCarryRunXp(0);
    setRunKey((k) => k + 1);
  };

  const getNextRoundBiome = (currentBiome: BiomeId, currentAnimal: AnimalId): BiomeId => {
    const pool: BiomeId[] =
      currentAnimal === 'indus_dolphin'
        ? ['indus_river', 'northern_mountains', 'deosai_plateau']
        : ['northern_mountains', 'deosai_plateau', 'ziarat_juniper', 'indus_river', 'thar_desert'];
    const idx = pool.indexOf(currentBiome);
    return pool[(idx + 1) % pool.length];
  };

  const handleNextRound = () => {
    const currentScore = simRef.current?.score ?? carryScore;
    const currentRunXp = simRef.current?.xpEarned ?? carryRunXp;
    const nextBiome = getNextRoundBiome(biomeId, animalId);
    setIsDailyMode(false);
    setCarryScore(Math.round(currentScore));
    setCarryRunXp(Math.round(currentRunXp));
    setRound((r) => r + 1);
    setBiomeId(nextBiome);
    setWeather(BIOMES[nextBiome].defaultWeather);
    setRunKey((k) => k + 1);
  };

  const handleBackToSetup = () => {
    if (simRef.current && simRef.current.elapsedSec > 8 && !recordSavedRef.current) {
      persistRunRecord(simRef.current.getSnapshot(), false);
    }
    soundEngine.stopSessionAudio();
    setScreen('setup');
  };

  const handleToggleMute = () => {
    const next = !muted;
    setMuted(next);
    soundEngine.setMuted(next);
  };

  const handleCall = () => {
    soundEngine.playAnimalCall(animalId, mode);
    sceneRef.current?.triggerCall();
  };

  if (screen === 'setup') {
    const selectedBiome = BIOMES[biomeId];
    const selectedChar = ANIMALS[animalId];
    const equippedSkin = getEquippedSkin(animalId, prog);
    const biomeCons = conservationMap[biomeId];

    return (
      <div className="min-h-screen bg-slate-950 text-slate-100">
        <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
          {/* Top Bar */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-4">
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={onNavigateHome}
                className="inline-flex items-center gap-1.5 rounded-xl border border-white/15 bg-slate-900 px-3.5 py-2 text-xs font-semibold text-slate-200 hover:border-emerald-400/50 hover:text-white"
              >
                <Home className="h-4 w-4" />
                <span>{lang === 'ur' ? 'صفحہ اول' : 'Home'}</span>
              </button>
              <MarkhorHillsLogo className="h-10 w-10 shrink-0" />
              <div>
                <h1 className="text-lg font-bold text-white sm:text-xl">{t.setupTitle}</h1>
                <p className="text-xs text-emerald-300">{t.setupSubtitle}</p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setLang(lang === 'en' ? 'ur' : 'en')}
                className="inline-flex items-center gap-1.5 rounded-xl border border-white/15 bg-slate-900 px-3 py-2 text-xs font-semibold text-slate-200 hover:border-emerald-400/40"
              >
                <Globe className="h-3.5 w-3.5 text-emerald-300" />
                <span>{lang === 'en' ? 'اردو' : 'EN'}</span>
              </button>
              <button
                type="button"
                onClick={() => setShowAlbum(true)}
                className="inline-flex items-center gap-1.5 rounded-xl border border-sky-400/30 bg-sky-500/10 px-3 py-2 text-xs font-medium text-sky-200 hover:bg-sky-500/20"
              >
                <Camera className="h-4 w-4" />
                <span>{savedPhotos.length}</span>
              </button>
              <button
                type="button"
                onClick={() => setShowGlbModal(true)}
                className="inline-flex items-center gap-1.5 rounded-xl border border-white/15 bg-slate-900 px-3 py-2 text-xs font-medium text-slate-200 hover:border-emerald-400/40"
              >
                <Box className="h-4 w-4 text-emerald-300" />
                .GLB
              </button>
              <button
                type="button"
                onClick={() => setShowRecords(true)}
                className="inline-flex items-center gap-1.5 rounded-xl border border-amber-400/30 bg-amber-500/10 px-3 py-2 text-xs font-medium text-amber-200 hover:bg-amber-500/20"
              >
                <History className="h-4 w-4" />
                <span>({records.length})</span>
              </button>
              <button
                type="button"
                onClick={() => setShowAuthModal(true)}
                className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-semibold ${
                  account
                    ? 'border-emerald-400/45 bg-emerald-500/15 text-emerald-200 hover:bg-emerald-500/25'
                    : 'border-white/20 bg-slate-900 text-slate-100 hover:border-emerald-400/50'
                }`}
              >
                {account ? (
                  <>
                    <UserCheck className="h-3.5 w-3.5 text-emerald-300" />
                    <span>{account.rangerName}</span>
                  </>
                ) : (
                  <>
                    <UserCircle2 className="h-3.5 w-3.5 text-emerald-300" />
                    <span>Login / Sign Up</span>
                  </>
                )}
              </button>
              <PWAInstallButton lang={lang} />
            </div>
          </div>

          {/* Ranger XP & Daily Expedition Strip */}
          <div className="mt-5 grid gap-4 md:grid-cols-2">
            <div className="rounded-2xl border border-emerald-400/25 bg-slate-900/90 p-4">
              <div className="flex items-center justify-between text-xs">
                <span className="font-bold text-emerald-300">
                  {t.xpProgress} · Level {levelInfo.level}
                </span>
                <span className="font-bold text-amber-300 tabular-nums">{prog.xp} XP</span>
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-800">
                <div
                  className="h-full bg-emerald-400"
                  style={{ width: `${Math.round(levelInfo.progress * 100)}%` }}
                />
              </div>
              <p className="mt-2 text-[11px] text-slate-400">
                {prog.xp < 120
                  ? `${120 - prog.xp} XP to unlock Brown Bear`
                  : prog.xp < 240
                    ? `${240 - prog.xp} XP to unlock Indus River Dolphin`
                    : 'All wildlife unlocked — keep earning XP for rare skins!'}
              </p>
            </div>

            <div
              className={`flex items-center justify-between gap-3 rounded-2xl border p-4 ${
                isDailyMode
                  ? 'border-amber-400 bg-amber-950/35'
                  : 'border-white/10 bg-slate-900/90'
              }`}
            >
              <div>
                <div className="flex items-center gap-1.5 text-xs font-bold text-amber-300">
                  <Calendar className="h-3.5 w-3.5" />
                  <span>
                    {t.dailyExpedition} ({daily.dateKey})
                  </span>
                </div>
                <div className="mt-1 text-xs font-semibold text-white">
                  {lang === 'ur' ? daily.titleUr : daily.title}
                </div>
                <div className="text-[11px] text-slate-300">
                  Shared daily map · Unlocks featured species · +150 Bonus XP
                </div>
              </div>
              <button
                type="button"
                onClick={() => handleToggleDaily(!isDailyMode)}
                className={`shrink-0 rounded-xl px-3.5 py-2 text-xs font-bold ${
                  isDailyMode
                    ? 'bg-amber-400 text-slate-950'
                    : 'border border-amber-400/40 bg-amber-500/15 text-amber-200 hover:bg-amber-500/25'
                }`}
              >
                {isDailyMode ? 'Active ✓' : 'Select Daily'}
              </button>
            </div>
          </div>

          <form onSubmit={handleLaunchRun} className="mt-5 space-y-5">
            {/* Step 1: Player Name + Co-op Room */}
            <div className="grid gap-5 md:grid-cols-2">
              <div className="rounded-2xl border border-white/10 bg-slate-900/90 p-5">
                <label
                  htmlFor="ranger-name"
                  className="block text-xs font-semibold tracking-wider text-emerald-300 uppercase"
                >
                  {t.rangerNameLabel}
                </label>
                <input
                  id="ranger-name"
                  type="text"
                  maxLength={24}
                  value={playerName}
                  onChange={(e) => {
                    setPlayerName(e.target.value);
                    if (nameError) setNameError('');
                  }}
                  placeholder={t.rangerNamePlaceholder}
                  className="mt-2 w-full rounded-xl border border-white/15 bg-slate-950 px-4 py-3 text-sm text-white placeholder:text-slate-500 focus:border-emerald-400 focus:outline-none"
                />
                {nameError && <p className="mt-2 text-xs font-medium text-rose-400">{nameError}</p>}
              </div>

              {/* Co-op Squad Setup */}
              <div className="rounded-2xl border border-white/10 bg-slate-900/90 p-5">
                <div className="flex items-center justify-between">
                  <span className="inline-flex items-center gap-1.5 text-xs font-semibold tracking-wider text-sky-300 uppercase">
                    <Users className="h-3.5 w-3.5" />
                    {t.coopMultiplayer}
                  </span>
                  <div className="flex gap-1.5">
                    <button
                      type="button"
                      onClick={() => handleSelectCoopSquad(false, 'rangers')}
                      className={`rounded-lg px-2.5 py-1 text-[11px] font-semibold ${
                        !coopEnabled
                          ? 'bg-emerald-500 text-slate-950'
                          : 'bg-slate-800 text-slate-300'
                      }`}
                    >
                      Solo
                    </button>
                    <button
                      type="button"
                      onClick={() => handleSelectCoopSquad(true, 'rangers')}
                      className={`rounded-lg px-2.5 py-1 text-[11px] font-semibold ${
                        coopEnabled && coopSquadMode === 'rangers'
                          ? 'bg-sky-400 text-slate-950'
                          : 'bg-slate-800 text-slate-300'
                      }`}
                    >
                      Rangers
                    </button>
                    <button
                      type="button"
                      onClick={() => handleSelectCoopSquad(true, 'wolf_pack')}
                      className={`rounded-lg px-2.5 py-1 text-[11px] font-semibold ${
                        coopEnabled && coopSquadMode === 'wolf_pack'
                          ? 'bg-amber-400 text-slate-950'
                          : 'bg-slate-800 text-slate-300'
                      }`}
                    >
                      Pack
                    </button>
                  </div>
                </div>
                {coopEnabled ? (
                  <div className="mt-2.5 flex items-center gap-2">
                    <input
                      type="text"
                      maxLength={12}
                      value={coopRoomCode}
                      onChange={(e) => setCoopRoomCode(e.target.value.toUpperCase())}
                      className="w-36 rounded-lg border border-sky-400/35 bg-slate-950 px-3 py-1.5 text-xs font-bold tracking-wider text-sky-200 uppercase focus:outline-none"
                      aria-label="Co-op Room Code"
                    />
                    <span className="text-[11px] text-slate-400">
                      Share room code to join the same live biome &amp; seed.
                    </span>
                  </div>
                ) : (
                  <p className="mt-2 text-xs text-slate-400">
                    Play solo or choose Rangers / Wildlife Pack to squad up live across tabs or server.
                  </p>
                )}
              </div>
            </div>

            {/* Step 2: Game Mode */}
            <div className="rounded-2xl border border-white/10 bg-slate-900/90 p-5">
              <div className="text-xs font-semibold tracking-wider text-emerald-300 uppercase">
                {t.modeLabel}
              </div>
              <div className="mt-3 grid gap-3 sm:grid-cols-3">
                {(
                  [
                    {
                      id: 'wild_life' as GameMode,
                      title: t.modes.wild_life,
                      desc: 'Grow Cub -> Adult, horn-strike predators, dodge Shikari shots, collect 5 Orbs.',
                      icon: Sparkles,
                    },
                    {
                      id: 'ranger_patrol' as GameMode,
                      title: t.modes.ranger_patrol,
                      desc: 'Swim rivers, dart & arrest poachers, rescue animals, lift Conservation %.',
                      icon: Shield,
                    },
                    {
                      id: 'photo_safari' as GameMode,
                      title: t.modes.photo_safari,
                      desc: 'Capture real 3D snapshots into your album; predators leave you alone.',
                      icon: Camera,
                    },
                  ]
                ).map((m) => {
                  const Icon = m.icon;
                  const active = mode === m.id;
                  return (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => handleSelectMode(m.id)}
                      className={`flex flex-col items-start rounded-xl border p-4 text-left transition-colors ${
                        active
                          ? 'border-emerald-400 bg-emerald-500/15'
                          : 'border-white/10 bg-slate-950/60 hover:border-white/25'
                      }`}
                    >
                      <Icon className={`h-5 w-5 ${active ? 'text-emerald-300' : 'text-slate-400'}`} />
                      <div className="mt-2.5 text-sm font-bold text-white">{m.title}</div>
                      <div className="mt-1 text-xs leading-relaxed text-slate-300">{m.desc}</div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Step 3: Character, Unlocks & Skins + Step 4: Biome */}
            <div className="grid gap-6 lg:grid-cols-2">
              <div className="rounded-2xl border border-white/10 bg-slate-900/90 p-5">
                <div className="text-xs font-semibold tracking-wider text-emerald-300 uppercase">
                  {t.animalLabel}
                </div>
                <div className="mt-3 space-y-2.5">
                  {ALL_CHARACTERS.filter((c) =>
                    mode === 'wild_life' ? c.id !== 'ranger' : c.id === 'ranger',
                  ).map((char) => {
                    const unlocked = isAnimalUnlocked(
                      char.id,
                      prog.xp,
                      isDailyMode ? daily.animalId : undefined,
                    );
                    const active = animalId === char.id;
                    return (
                      <div
                        key={char.id}
                        className={`rounded-xl border px-4 py-3 transition-colors ${
                          active
                            ? 'border-emerald-400 bg-emerald-500/15'
                            : unlocked
                              ? 'border-white/10 bg-slate-950/60 hover:border-white/25'
                              : 'border-white/5 bg-slate-950/35 opacity-70'
                        }`}
                      >
                        <button
                          type="button"
                          disabled={!unlocked}
                          onClick={() => handleSelectAnimal(char.id)}
                          className="flex w-full flex-col gap-1 text-left"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-sm font-bold text-white">
                              {lang === 'ur' ? char.nameUr : char.name}
                            </span>
                            {unlocked ? (
                              <span className="rounded bg-white/10 px-2 py-0.5 text-[10px] text-amber-300">
                                Home: {BIOMES[char.homeBiome].name}
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 rounded bg-slate-800 px-2 py-0.5 text-[10px] font-semibold text-amber-300">
                                <Lock className="h-3 w-3" />
                                Unlock at {char.unlockXp} XP
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-slate-300">{char.shortDesc}</p>
                        </button>

                        {/* Coat Skins Selector when Selected */}
                        {active && (
                          <div className="mt-2.5 flex flex-wrap gap-1.5 border-t border-white/10 pt-2">
                            {char.skins.map((sk) => {
                              const skUnlocked = isSkinUnlocked(sk, prog.xp);
                              const skActive = equippedSkin.id === sk.id;
                              return (
                                <button
                                  key={sk.id}
                                  type="button"
                                  disabled={!skUnlocked}
                                  onClick={() => setProg(equipSkin(char.id, sk.id))}
                                  className={`inline-flex items-center gap-1.5 rounded-lg border px-2 py-1 text-[10px] font-semibold ${
                                    skActive
                                      ? 'border-amber-300 bg-amber-500/20 text-amber-200'
                                      : skUnlocked
                                        ? 'border-white/15 bg-slate-900 text-slate-300 hover:border-white/30'
                                        : 'border-white/5 bg-slate-950 text-slate-500'
                                  }`}
                                >
                                  <span
                                    className="inline-block h-2.5 w-2.5 rounded-full border border-white/40"
                                    style={{ backgroundColor: sk.primaryColor }}
                                  />
                                  <span>{lang === 'ur' ? sk.nameUr : sk.name}</span>
                                  {!skUnlocked && <span>({sk.xpRequired} XP)</span>}
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                <div className="mt-4 rounded-xl border border-amber-400/25 bg-amber-950/25 p-3 text-xs">
                  <div className="font-semibold text-amber-300">Wilderness Challenge</div>
                  <p className="mt-1 leading-relaxed text-slate-200">{selectedChar.challengeDesc}</p>
                </div>
              </div>

              {/* Step 4: Biome, Conservation & Season */}
              <div className="rounded-2xl border border-white/10 bg-slate-900/90 p-5">
                <div className="text-xs font-semibold tracking-wider text-emerald-300 uppercase">
                  {t.biomeLabel}
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {BIOME_LIST.map((b) => {
                    const isHome = ANIMALS[animalId].homeBiome === b.id;
                    const active = biomeId === b.id;
                    return (
                      <button
                        key={b.id}
                        type="button"
                        disabled={isDailyMode}
                        onClick={() => handleSelectBiome(b.id)}
                        className={`rounded-xl border px-3 py-2 text-xs font-semibold transition-colors ${
                          active
                            ? 'border-emerald-400 bg-emerald-500/20 text-emerald-200'
                            : 'border-white/10 bg-slate-950/60 text-slate-300 hover:border-white/25'
                        }`}
                      >
                        {lang === 'ur' ? b.nameUr : b.name}
                        {isHome ? ' ★' : ''}
                      </button>
                    );
                  })}
                </div>

                {/* Biome Details + Conservation Meter */}
                <div className="mt-3 rounded-xl border border-white/5 bg-slate-950/65 p-3.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-white">{selectedBiome.region}</span>
                    <span className="inline-flex items-center gap-1 font-bold text-emerald-300 tabular-nums">
                      <ShieldCheck className="h-3.5 w-3.5" />
                      {biomeCons.conservationScore}% · {biomeCons.speciesCount} Species
                    </span>
                  </div>
                  <p className="mt-1 text-xs leading-relaxed text-slate-300">
                    {selectedBiome.description}
                  </p>
                </div>

                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <div>
                    <div className="mb-1.5 text-[11px] font-medium text-slate-400 uppercase">
                      Season (Migration)
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {(['spring', 'summer', 'autumn', 'winter'] as SeasonId[]).map((s) => (
                        <button
                          key={s}
                          type="button"
                          disabled={isDailyMode}
                          onClick={() => setSeason(s)}
                          className={`rounded-lg px-2.5 py-1 text-xs capitalize ${
                            season === s
                              ? 'bg-amber-400 font-bold text-slate-950'
                              : 'bg-slate-800 text-slate-300'
                          }`}
                        >
                          {t.seasons[s]}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <div className="mb-1.5 text-[11px] font-medium text-slate-400 uppercase">
                      Weather
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {selectedBiome.availableWeather.map((w) => (
                        <button
                          key={w}
                          type="button"
                          onClick={() => setWeather(w)}
                          className={`rounded-lg px-2.5 py-1 text-xs capitalize ${
                            weather === w
                              ? 'bg-sky-400 font-bold text-slate-950'
                              : 'bg-slate-800 text-slate-300'
                          }`}
                        >
                          {w}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-emerald-400/30 bg-emerald-950/35 p-5">
              <div>
                <div className="text-sm font-bold text-white">
                  {isDailyMode ? `${t.dailyExpedition}: ` : ''}
                  {MODE_LABELS[mode]} · {lang === 'ur' ? selectedChar.nameUr : selectedChar.name} (
                  {equippedSkin.name}) in {lang === 'ur' ? selectedBiome.nameUr : selectedBiome.name}
                </div>
                <div className="mt-0.5 text-xs text-emerald-200/80">
                  {isDailyMode
                    ? daily.goalText
                    : '1–2 minute rounds · New missions each round · Shared Supabase Hall of Rangers.'}
                </div>
              </div>
              <button
                type="submit"
                className="inline-flex items-center gap-2.5 rounded-xl bg-emerald-500 px-7 py-3.5 text-base font-bold text-slate-950 shadow-lg hover:bg-emerald-400"
              >
                <Play className="h-5 w-5 fill-current" />
                {t.startExpedition}
              </button>
            </div>
          </form>
        </div>

        {showRecords && <RecordsModal records={records} onClose={() => setShowRecords(false)} />}
        {showAlbum && (
          <PhotoAlbumModal
            photos={savedPhotos}
            lang={lang}
            onPhotosChange={setSavedPhotos}
            onClose={() => setShowAlbum(false)}
          />
        )}
        {showGlbModal && (
          <CustomGlbModal
            onClose={() => setShowGlbModal(false)}
            onModelUpdated={() => sceneRef.current?.rebuildPlayerModel()}
          />
        )}
        {showAuthModal && (
          <AuthModal
            account={account}
            onAuthChange={(next) => {
              setAccount(next);
              setProg(loadProgression());
              if (next?.rangerName) setPlayerName(next.rangerName);
            }}
            onClose={() => setShowAuthModal(false)}
          />
        )}
      </div>
    );
  }

  const snap = snapshot;
  const cameraYaw = sceneRef.current?.getCameraYaw() ?? 0;
  const relativeArrowDeg = snap ? ((snap.guideWorldAngle - cameraYaw) * 180) / Math.PI : 0;
  const activeChar = ANIMALS[snap?.animalId ?? animalId];
  const ending = snap ? getConservationEnding(snap.conservationScore) : null;

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-slate-950 select-none">
      <div ref={canvasMountRef} className="absolute inset-0 h-full w-full" />

      {shutterFlash && (
        <div className="pointer-events-none absolute inset-0 z-30 bg-white/75 transition-opacity" />
      )}

      {/* Damage Hurt Border Flash on Shikari Rifle Hit */}
      {snap?.playerHurtFlash && (
        <div className="pointer-events-none fixed inset-0 z-30 border-8 border-rose-500/80 bg-rose-600/20" />
      )}

      {snap && (
        <div className="pointer-events-none fixed inset-0 z-20 flex flex-col justify-between p-3 sm:p-4">
          <div className="flex items-start justify-between gap-2">
            {/* Top-Left: Vitals, Growth Stage & Conservation */}
            <div className="w-56 rounded-xl border border-white/15 bg-slate-950/85 p-3 text-slate-100 shadow-lg sm:w-64">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-xs font-bold text-emerald-300">
                  Rd {snap.round} · {lang === 'ur' ? BIOMES[snap.biomeId].nameUr : BIOMES[snap.biomeId].name}
                </span>
                <span className="text-xs font-bold text-amber-300 tabular-nums">
                  {snap.score} pts
                </span>
              </div>
              <div className="mt-0.5 flex items-center justify-between text-[11px] text-slate-300">
                <span className="truncate">
                  {lang === 'ur' ? activeChar.nameUr : activeChar.name}
                  {snap.animalId !== 'ranger' && (
                    <span className="ml-1.5 rounded bg-emerald-500/20 px-1.5 py-0.5 text-[9px] font-bold text-emerald-300 uppercase">
                      {snap.growthStage === 'cub'
                        ? t.growthCub
                        : snap.growthStage === 'juvenile'
                          ? t.growthJuvenile
                          : t.growthAdult}
                    </span>
                  )}
                </span>
                <span
                  className={`font-bold tabular-nums ${
                    snap.roundTimeLeftSec <= 20 ? 'text-amber-300' : 'text-sky-300'
                  }`}
                >
                  {formatDuration(snap.roundTimeLeftSec)} left
                </span>
              </div>

              {/* Cub -> Juvenile -> Adult Growth Bar */}
              {snap.animalId !== 'ranger' && (
                <div className="mt-1.5">
                  <div className="flex items-center justify-between text-[9px] text-slate-400">
                    <span>
                      {snap.growthStage === 'adult'
                        ? 'Adult Mastery (100%)'
                        : snap.growthStage === 'cub'
                          ? 'Growth: Cub -> Juvenile'
                          : 'Growth: Juvenile -> Adult'}
                    </span>
                    <span className="tabular-nums text-emerald-300">
                      {Math.round(snap.growthProgress * 100)}%
                    </span>
                  </div>
                  <div className="mt-0.5 h-1 overflow-hidden rounded-full bg-slate-800">
                    <div
                      className="h-full bg-emerald-400"
                      style={{ width: `${Math.round(snap.growthProgress * 100)}%` }}
                    />
                  </div>
                </div>
              )}

              {/* Active 1-2 Min Round Mission */}
              <div className="mt-2 rounded-lg border border-amber-400/25 bg-amber-950/25 px-2.5 py-1.5">
                <div className="flex items-center justify-between gap-2 text-[10px]">
                  <span className="truncate font-bold text-amber-300">
                    {snap.roundMissionTitle}
                  </span>
                  <span className="shrink-0 font-semibold text-emerald-300 tabular-nums">
                    {snap.roundMissionProgress}
                  </span>
                </div>
                <p className="mt-0.5 line-clamp-2 text-[10px] leading-snug text-slate-300">
                  {snap.roundMissionText}
                </p>
              </div>

              {/* Conservation Meter Line */}
              <div className="mt-1.5 flex items-center justify-between text-[10px] text-slate-300">
                <span className="inline-flex items-center gap-1">
                  <ShieldCheck className="h-3 w-3 text-emerald-300" />
                  {t.conservationMeter}: {snap.conservationScore}%
                </span>
                <span className="text-sky-300">{snap.speciesCount} sp.</span>
              </div>

              {snap.mode === 'wild_life' && (
                <div className="mt-2 space-y-1.5 text-[11px] tabular-nums">
                  <StatBar label="HP" value={snap.health} color="bg-emerald-400" />
                  <StatBar label="Food" value={snap.food} color="bg-amber-400" icon={<Utensils className="h-3 w-3" />} />
                  <StatBar label="Water" value={snap.water} color="bg-sky-400" icon={<Droplets className="h-3 w-3" />} />
                  <StatBar label="Energy" value={snap.energy} color="bg-violet-400" icon={<Zap className="h-3 w-3" />} />
                  {snap.animalId === 'indus_dolphin' && (
                    <StatBar label="Oxygen" value={snap.oxygen} color="bg-cyan-300" icon={<Wind className="h-3 w-3" />} />
                  )}
                  <div className="flex items-center justify-between pt-0.5 text-[11px] text-slate-300">
                    <span className="inline-flex items-center gap-1">
                      <Flame className="h-3 w-3 text-amber-300" />
                      {snap.temperatureC}°C · +{snap.xpEarned} XP
                    </span>
                    <span className="font-semibold text-emerald-300">
                      Orbs {snap.orbsCollected}/{snap.orbsTarget}
                    </span>
                  </div>
                </div>
              )}

              {snap.mode === 'ranger_patrol' && (
                <div className="mt-2 space-y-1 text-xs tabular-nums">
                  <div className="flex justify-between">
                    <span className="text-slate-300">Poachers Arrested</span>
                    <span className="font-bold text-amber-300">
                      {snap.poachersArrested}/{snap.poachersTotal}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-300">Animals Rescued</span>
                    <span className="font-bold text-emerald-300">
                      {snap.animalsRescued}/{snap.animalsTrappedTotal}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-300">Snares Cleared</span>
                    <span className="font-bold text-sky-300">
                      {snap.snaresCleared}/{snap.snaresTotal}
                    </span>
                  </div>
                </div>
              )}

              {snap.mode === 'photo_safari' && (
                <div className="mt-2 space-y-1.5 text-xs tabular-nums">
                  <div className="flex justify-between">
                    <span className="text-slate-300">Species Logged</span>
                    <span className="font-bold text-sky-300">
                      {snap.photosTaken}/{snap.photosTarget}
                    </span>
                  </div>
                  <div className="flex justify-between text-[11px]">
                    <span className="text-slate-400">S-Rank / Rare+</span>
                    <span className="font-semibold text-amber-300">
                      {snap.sRankCount} S · {snap.rareShotsCount} Rare+
                    </span>
                  </div>
                  <div
                    className={`rounded-lg border px-2.5 py-1.5 text-[10px] ${
                      snap.safariChallengeDone
                        ? 'border-emerald-400/45 bg-emerald-500/15 text-emerald-200'
                        : 'border-amber-400/35 bg-amber-500/10 text-amber-200'
                    }`}
                  >
                    <div className="flex items-center justify-between font-bold">
                      <span>
                        {snap.safariChallengeDone ? '✓ ' : '★ '}
                        {snap.safariChallengeTitle}
                      </span>
                      <span>
                        {snap.safariChallengeDone
                          ? `+${snap.safariChallengeBonus}`
                          : snap.safariChallengeProgress}
                      </span>
                    </div>
                    <p className="mt-0.5 text-[10px] leading-snug text-slate-300">
                      {snap.safariChallengeText}
                    </p>
                  </div>
                  <div className="grid grid-cols-2 gap-1.5">
                    <button
                      type="button"
                      onClick={() => setShowFieldGuide(true)}
                      className="pointer-events-auto flex items-center justify-center gap-1 rounded-lg border border-sky-400/30 bg-sky-500/15 py-1.5 text-[11px] font-semibold text-sky-200 hover:bg-sky-500/25"
                    >
                      <BookOpen className="h-3.5 w-3.5" />
                      Guide
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowAlbum(true)}
                      className="pointer-events-auto flex items-center justify-center gap-1 rounded-lg border border-amber-400/30 bg-amber-500/15 py-1.5 text-[11px] font-semibold text-amber-200 hover:bg-amber-500/25"
                    >
                      <Camera className="h-3.5 w-3.5" />
                      Album ({savedPhotos.length})
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Top-Center: Guide Arrow + Migration + Danger / Prey Telegraphs */}
            <div className="hidden flex-col items-center gap-1.5 sm:flex">
              <div className="flex items-center gap-2.5 rounded-xl border border-white/15 bg-slate-950/85 px-3.5 py-2 shadow-lg">
                <div
                  className="flex h-7 w-7 items-center justify-center rounded-full border border-emerald-400/40 bg-emerald-500/15 text-emerald-300"
                  style={{ transform: `rotate(${-relativeArrowDeg}deg)` }}
                >
                  <Navigation className="h-4 w-4 fill-current" />
                </div>
                <div className="text-xs">
                  <div className="font-semibold text-white">{snap.guideTargetLabel}</div>
                  <div className="text-[11px] text-slate-400 tabular-nums">
                    {snap.guideDistance}m · {snap.isDiving ? 'Deep Dive' : snap.isAirborne ? 'Airborne' : snap.isSwimming ? 'Swimming' : snap.playerGait}
                  </div>
                </div>
              </div>

              <div className="rounded-lg border border-white/10 bg-slate-950/80 px-2.5 py-0.5 text-[10px] text-slate-300">
                {snap.migrationLabel}
              </div>

              {coopEnabled && (
                <div className="rounded-lg border border-sky-400/35 bg-sky-950/85 px-3 py-0.5 text-[10px] font-semibold text-sky-200">
                  Squad {coopRoomCode} · {coopPeers.length} Teammate(s) ({coopTransport})
                </div>
              )}

              {coopToast && (
                <div className="rounded-lg border border-emerald-400/45 bg-emerald-950/90 px-3 py-1 text-xs font-semibold text-emerald-200">
                  {coopToast}
                </div>
              )}

              {snap.dangerWarning && (
                <div className="inline-flex items-center gap-1.5 rounded-lg border border-rose-400/50 bg-rose-950/90 px-3 py-1 text-xs font-semibold text-rose-200">
                  <AlertTriangle className="h-3.5 w-3.5 text-rose-300" />
                  {snap.dangerWarning}
                </div>
              )}

              {snap.spottedPreyName && snap.animalId === 'snow_leopard' && (
                <div className="rounded-lg border border-amber-400/45 bg-amber-950/85 px-3 py-1 text-xs font-semibold text-amber-200">
                  Prey Spotted: {snap.spottedPreyName} — Space to Pounce!
                </div>
              )}
            </div>

            {/* Top-Right: Action Controls */}
            <div className="pointer-events-auto flex flex-wrap items-center justify-end gap-1.5">
              <button
                type="button"
                onClick={() => setLang(lang === 'en' ? 'ur' : 'en')}
                className="flex h-9 items-center gap-1 rounded-xl border border-white/15 bg-slate-950/85 px-2.5 text-xs font-semibold text-slate-200 hover:border-emerald-400/40"
              >
                {lang === 'en' ? 'اردو' : 'EN'}
              </button>
              <button
                type="button"
                onClick={handleCall}
                title="Animal Call (E)"
                className="flex h-9 items-center gap-1 rounded-xl border border-white/15 bg-slate-950/85 px-2.5 text-xs font-medium text-amber-300 hover:border-amber-400/50"
              >
                <Volume2 className="h-4 w-4" />
                <span className="hidden sm:inline">Call</span>
              </button>
              <button
                type="button"
                onClick={handleToggleMute}
                title={muted ? 'Unmute' : 'Mute'}
                className="flex h-9 w-9 items-center justify-center rounded-xl border border-white/15 bg-slate-950/85 text-slate-200 hover:border-white/35"
              >
                {muted ? <VolumeX className="h-4 w-4 text-rose-300" /> : <Volume2 className="h-4 w-4" />}
              </button>
              <button
                type="button"
                onClick={() => setShowRecords(true)}
                title="Records & History"
                className="flex h-9 w-9 items-center justify-center rounded-xl border border-white/15 bg-slate-950/85 text-slate-200 hover:border-white/35"
              >
                <History className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => {
                  simRef.current?.togglePause();
                  if (simRef.current) setSnapshot(simRef.current.getSnapshot());
                }}
                title="Pause (Esc)"
                className="flex h-9 w-9 items-center justify-center rounded-xl border border-white/15 bg-slate-950/85 text-slate-200 hover:border-white/35"
              >
                <Pause className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* Center Optical Overlays: Binoculars Scope / Dart Crosshair / Camera Viewfinder */}
          {snap.phase === 'playing' &&
            snap.mode === 'ranger_patrol' &&
            snap.equippedTool === 'binoculars' && (
              <div className="pointer-events-none mx-auto flex w-80 flex-col items-center sm:w-[26rem]">
                <div className="relative flex h-44 w-full items-center justify-center rounded-full border-2 border-amber-300/65 bg-slate-950/15 shadow-inner">
                  <div className="pointer-events-none absolute inset-x-8 top-1/2 h-px bg-amber-300/35" />
                  <div className="pointer-events-none absolute inset-y-6 left-1/2 w-px bg-amber-300/35" />
                  <div className="absolute top-2.5 flex items-center gap-2">
                    <span className="rounded bg-slate-950/85 px-2 py-0.5 text-[10px] font-bold text-amber-300">
                      {snap.binocularsZoomed ? '4.5× ZOOM' : '1.0× WIDE'}
                    </span>
                    <span className="rounded bg-slate-950/85 px-2 py-0.5 text-[10px] font-semibold text-emerald-300 tabular-nums">
                      Scouted: {snap.scoutedCount}
                    </span>
                  </div>

                  {snap.binocularsTarget ? (
                    <div className="pointer-events-auto z-10 mt-10 flex flex-col items-center rounded-xl border border-amber-400/50 bg-slate-950/90 px-3.5 py-2 text-center shadow-xl">
                      <div className="text-[10px] font-bold tracking-wider text-amber-300 uppercase">
                        {snap.binocularsTarget.category} · {snap.binocularsTarget.distance}m
                      </div>
                      <div className="text-xs font-bold text-white">{snap.binocularsTarget.name}</div>
                      <div className="text-[10px] text-slate-300">
                        {snap.binocularsTarget.statusText}
                      </div>
                      <button
                        type="button"
                        onClick={() => sceneRef.current?.triggerAction()}
                        className={`mt-1.5 rounded-lg px-3 py-1 text-[10px] font-bold ${
                          snap.binocularsTarget.alreadyScouted
                            ? 'bg-emerald-500/20 text-emerald-300'
                            : 'bg-amber-400 text-slate-950 hover:bg-amber-300'
                        }`}
                      >
                        {snap.binocularsTarget.alreadyScouted
                          ? 'Tagged ✓ (Space: Toggle Zoom)'
                          : 'Scout & Tag [Space] (+65 pts)'}
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => sceneRef.current?.toggleOpticZoom()}
                      className="pointer-events-auto mt-16 rounded-lg border border-white/15 bg-slate-950/80 px-3 py-1 text-[10px] text-slate-200 hover:border-amber-300/50"
                    >
                      Scan hills for Poachers &amp; Cages · Click to toggle Zoom
                    </button>
                  )}
                </div>
              </div>
            )}

          {snap.phase === 'playing' &&
            snap.mode === 'ranger_patrol' &&
            snap.equippedTool === 'dart' && (
              <div className="pointer-events-none mx-auto flex flex-col items-center gap-1.5">
                <div
                  className={`flex h-12 w-12 items-center justify-center rounded-full border-2 ${
                    snap.dartTargetName
                      ? 'border-emerald-400 bg-emerald-500/15 text-emerald-300'
                      : 'border-white/30 bg-slate-950/20 text-white/70'
                  }`}
                >
                  <Crosshair className="h-6 w-6" />
                </div>
                {snap.dartTargetName ? (
                  <button
                    type="button"
                    onClick={() => sceneRef.current?.triggerAction()}
                    className="pointer-events-auto rounded-lg border border-emerald-400/50 bg-slate-950/90 px-3 py-1 text-[11px] font-bold text-emerald-300 hover:bg-slate-900"
                  >
                    LOCK: {snap.dartTargetName} ({snap.dartTargetDistance}m) · Fire [Space]
                  </button>
                ) : (
                  <div className="rounded-md bg-slate-950/70 px-2.5 py-0.5 text-[10px] text-slate-300">
                    Dart Rifle {snap.primaryCooldown > 0 ? `Reloading ${snap.primaryCooldown}s` : 'Ready [Space]'}
                  </div>
                )}
              </div>
            )}

          {/* Photo Safari OR Ranger Field Camera Viewfinder */}
          {(snap.mode === 'photo_safari' ||
            (snap.mode === 'ranger_patrol' && snap.equippedTool === 'camera')) &&
            snap.phase === 'playing' && (
              <div className="pointer-events-none mx-auto flex w-80 flex-col items-center sm:w-96">
                <div
                  className={`relative h-44 w-full rounded-xl border-2 border-dashed ${
                    snap.photoTarget
                      ? snap.photoTarget.qualityGrade === 'S'
                        ? 'border-amber-300/85'
                        : 'border-emerald-300/80'
                      : 'border-white/35'
                  }`}
                >
                  <div className="absolute -left-1 -top-1 h-4 w-4 border-l-2 border-t-2 border-sky-300" />
                  <div className="absolute -right-1 -top-1 h-4 w-4 border-r-2 border-t-2 border-sky-300" />
                  <div className="absolute -bottom-1 -left-1 h-4 w-4 border-b-2 border-l-2 border-sky-300" />
                  <div className="absolute -bottom-1 -right-1 h-4 w-4 border-b-2 border-r-2 border-sky-300" />

                  {/* Top Reticle Status Strip */}
                  <div className="flex items-center justify-between px-2.5 pt-2 text-[10px]">
                    <span className="rounded bg-slate-950/85 px-2 py-0.5 font-bold text-sky-300">
                      {snap.mode === 'ranger_patrol'
                        ? 'RANGER DSLR · EVIDENCE & WILDLIFE'
                        : snap.telephotoZoomed
                          ? '2.2× TELEPHOTO LENS'
                          : '1.0× SAFARI LENS'}
                    </span>
                    <div className="flex items-center gap-1">
                      {snap.photoCombo > 1 && (
                        <span className="rounded bg-amber-500/25 px-1.5 py-0.5 font-bold text-amber-300">
                          {snap.photoCombo}× COMBO
                        </span>
                      )}
                      {snap.lastPhotoGrade && (
                        <span className="rounded bg-emerald-500/25 px-1.5 py-0.5 font-bold text-emerald-200">
                          Last: {snap.lastPhotoGrade}-Rank
                        </span>
                      )}
                    </div>
                  </div>

                  {snap.photoTarget ? (
                    <div className="flex h-[calc(100%-26px)] flex-col items-center justify-end p-2.5 text-center">
                      <div className="pointer-events-auto rounded-xl border border-white/15 bg-slate-950/90 px-3.5 py-2 shadow-xl">
                        <div className="flex flex-wrap items-center justify-center gap-1.5">
                          <span
                            className={`rounded border px-1.5 py-0.5 text-[10px] font-bold uppercase ${
                              SPECIES_RARITY_META[snap.photoTarget.rarity].badgeCls
                            }`}
                          >
                            {snap.photoTarget.rarityLabel}
                          </span>
                          <span
                            className={`rounded px-1.5 py-0.5 text-[10px] font-extrabold ${
                              snap.photoTarget.qualityGrade === 'S'
                                ? 'bg-amber-400 text-slate-950'
                                : snap.photoTarget.qualityGrade === 'A'
                                  ? 'bg-emerald-400 text-slate-950'
                                  : 'bg-sky-400 text-slate-950'
                            }`}
                          >
                            {snap.photoTarget.qualityGrade}-RANK
                          </span>
                          <span className="text-xs font-bold text-white">
                            {snap.photoTarget.speciesName} · {snap.photoTarget.distance}m
                          </span>
                          <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-bold text-amber-200 tabular-nums">
                            +{snap.photoTarget.projectedPoints} pts
                          </span>
                        </div>

                        <div className="mt-0.5 text-[10px] text-slate-300">
                          {snap.photoTarget.scoreBreakdownText}
                        </div>

                        {(snap.photoTarget.actionTag || snap.photoTarget.isSpeciesOfDay) && (
                          <div className="mt-1 flex flex-wrap justify-center gap-1 text-[10px] font-bold">
                            {snap.photoTarget.isSpeciesOfDay && (
                              <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-amber-300">
                                ★ SPECIES OF THE DAY 2×
                              </span>
                            )}
                            {snap.photoTarget.actionTag && (
                              <span className="rounded bg-emerald-500/20 px-1.5 py-0.5 text-emerald-300">
                                ⚡ {snap.photoTarget.actionTag}
                              </span>
                            )}
                          </div>
                        )}

                        <div className="mt-1.5 h-1.5 w-44 overflow-hidden rounded-full bg-slate-700">
                          <div
                            className="h-full bg-sky-400 transition-all"
                            style={{ width: `${Math.round(snap.photoTarget.steadyProgress * 100)}%` }}
                          />
                        </div>

                        <div className="mt-1.5 flex items-center justify-center gap-2">
                          <button
                            type="button"
                            onClick={() => sceneRef.current?.triggerAction()}
                            className="inline-flex items-center gap-1 rounded-lg bg-sky-500 px-3 py-1 text-[11px] font-bold text-slate-950 hover:bg-sky-400"
                          >
                            <Camera className="h-3.5 w-3.5" />
                            <span>
                              {snap.photoTarget.alreadyPhotographed
                                ? 'Snap Action Shot [Space]'
                                : 'SNAP NOW [Space]'}
                            </span>
                          </button>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="flex h-[calc(100%-26px)] flex-col items-center justify-center gap-1.5 px-4 text-center">
                      <div className="rounded-lg bg-slate-950/75 px-3 py-1.5 text-[11px] text-slate-200">
                        Aim at wildlife (follow top arrow) · Hold steady OR press{' '}
                        <span className="font-bold text-sky-300">Space</span> to Snap!
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

          {/* Bottom Ability Bar, Ranger Toolkit Dock & Status Toast */}
          <div className="flex flex-col items-center gap-2">
            {snap.statusMessage && (
              <div className="rounded-xl border border-emerald-400/35 bg-slate-950/90 px-4 py-2 text-xs font-semibold text-emerald-200 shadow-lg">
                {snap.statusMessage}
              </div>
            )}

            {/* RANGER TOOLKIT DOCK (Ranger Patrol Mode) */}
            {snap.mode === 'ranger_patrol' && (
              <div className="pointer-events-auto mb-28 flex flex-wrap items-center justify-center gap-2 rounded-2xl border border-white/15 bg-slate-950/90 px-3 py-2 shadow-xl md:mb-0">
                {(
                  [
                    {
                      id: 'binoculars' as RangerToolId,
                      key: '1',
                      label: 'Binoculars',
                      sub: snap.binocularsZoomed ? '4.5× Zoom' : 'Scout',
                      icon: Binoculars,
                      activeCls: 'border-amber-400 bg-amber-500/20 text-amber-200',
                    },
                    {
                      id: 'camera' as RangerToolId,
                      key: '2',
                      label: 'Camera',
                      sub: `${snap.evidencePhotosTaken + snap.photosTaken} Logged`,
                      icon: Camera,
                      activeCls: 'border-sky-400 bg-sky-500/20 text-sky-200',
                    },
                    {
                      id: 'dart' as RangerToolId,
                      key: '3',
                      label: 'Tranq Dart',
                      sub: snap.primaryCooldown > 0 ? `${snap.primaryCooldown}s` : 'Ready',
                      icon: Crosshair,
                      activeCls: 'border-emerald-400 bg-emerald-500/20 text-emerald-200',
                    },
                  ]
                ).map((tool) => {
                  const Icon = tool.icon;
                  const active = snap.equippedTool === tool.id;
                  return (
                    <button
                      key={tool.id}
                      type="button"
                      onClick={() => sceneRef.current?.setRangerTool(tool.id)}
                      className={`flex items-center gap-2 rounded-xl border px-2.5 py-1.5 text-left transition-colors ${
                        active
                          ? tool.activeCls
                          : 'border-white/10 bg-slate-900/90 text-slate-300 hover:border-white/25'
                      }`}
                    >
                      <span className="rounded bg-slate-950 px-1.5 py-0.5 text-[10px] font-bold text-slate-400">
                        {tool.key}
                      </span>
                      <Icon className="h-4 w-4 shrink-0" />
                      <div className="leading-tight">
                        <div className="text-[11px] font-bold">{tool.label}</div>
                        <div className="text-[9px] opacity-80 tabular-nums">{tool.sub}</div>
                      </div>
                    </button>
                  );
                })}

                <div className="hidden h-7 w-px bg-white/10 md:block" />

                <button
                  type="button"
                  onClick={() => sceneRef.current?.triggerAction()}
                  className="hidden items-center gap-1.5 rounded-xl bg-emerald-500 px-3 py-1.5 text-xs font-bold text-slate-950 hover:bg-emerald-400 md:inline-flex"
                >
                  <span>
                    {snap.equippedTool === 'binoculars'
                      ? 'Scan / Zoom'
                      : snap.equippedTool === 'camera'
                        ? 'Snap Photo'
                        : 'Fire Dart'}
                  </span>
                  <span className="rounded bg-slate-950/20 px-1.5 py-0.5 text-[10px]">Space</span>
                </button>

                <button
                  type="button"
                  onClick={() => sceneRef.current?.triggerSecondaryAction()}
                  className="hidden items-center gap-1 rounded-xl border border-amber-400/35 bg-amber-500/15 px-2.5 py-1.5 text-xs font-semibold text-amber-200 hover:bg-amber-500/25 md:inline-flex"
                >
                  <ArrowUp className="h-3.5 w-3.5" />
                  <span>Vault (F)</span>
                </button>
              </div>
            )}

            {/* PHOTO SAFARI INTERACTIVE CONTROLS BAR */}
            {snap.mode === 'photo_safari' && (
              <div className="pointer-events-auto hidden items-center gap-2 rounded-2xl border border-sky-400/30 bg-slate-950/90 px-3.5 py-2 shadow-xl md:flex">
                <button
                  type="button"
                  onClick={() => sceneRef.current?.triggerAction()}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-sky-500 px-3.5 py-1.5 text-xs font-bold text-slate-950 hover:bg-sky-400"
                >
                  <Camera className="h-4 w-4" />
                  <span>Snap Photo</span>
                  <span className="rounded bg-slate-950/20 px-1.5 py-0.5 text-[10px]">Space</span>
                </button>
                <button
                  type="button"
                  onClick={() => sceneRef.current?.toggleOpticZoom()}
                  className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-semibold ${
                    snap.telephotoZoomed
                      ? 'border-amber-400 bg-amber-500/20 text-amber-200'
                      : 'border-white/15 bg-slate-900 text-slate-200 hover:border-sky-400/40'
                  }`}
                >
                  <ZoomIn className="h-3.5 w-3.5" />
                  <span>{snap.telephotoZoomed ? '2.2× Telephoto ON' : 'Telephoto Zoom'}</span>
                  <span className="rounded bg-slate-950 px-1.5 py-0.5 text-[10px]">F</span>
                </button>
                <button
                  type="button"
                  onClick={handleCall}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-white/15 bg-slate-900 px-3 py-1.5 text-xs font-semibold text-amber-200 hover:border-amber-400/40"
                >
                  <Volume2 className="h-3.5 w-3.5" />
                  <span>Call Wildlife (Pose!)</span>
                  <span className="rounded bg-slate-950 px-1.5 py-0.5 text-[10px]">E</span>
                </button>
                <span className="pl-1 text-[11px] text-slate-300">
                  Saves 3D Album · Boosts Conservation %
                </span>
              </div>
            )}

            {/* WILD LIFE ABILITY BAR */}
            {snap.mode === 'wild_life' && (
              <div className="pointer-events-auto hidden items-center gap-2 rounded-xl border border-white/15 bg-slate-950/85 px-3 py-1.5 md:flex">
                <button
                  type="button"
                  onClick={() => sceneRef.current?.triggerAction()}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-500/20 px-2.5 py-1 text-xs font-semibold text-emerald-200 hover:bg-emerald-500/30 tabular-nums"
                >
                  <ArrowUp className="h-3.5 w-3.5" />
                  <span>{lang === 'ur' ? activeChar.primaryAbility.nameUr : activeChar.primaryAbility.name}</span>
                  <span className="rounded bg-slate-900 px-1.5 py-0.5 text-[10px] text-slate-300">
                    {snap.primaryCooldown > 0 ? `${snap.primaryCooldown}s` : activeChar.primaryAbility.keyHint}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => sceneRef.current?.triggerSecondaryAction()}
                  className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-semibold tabular-nums ${
                    snap.isDiving || snap.secondaryActive
                      ? 'bg-sky-500/30 text-sky-200'
                      : 'bg-amber-500/15 text-amber-200 hover:bg-amber-500/25'
                  }`}
                >
                  {snap.animalId === 'indus_dolphin' && <ArrowDown className="h-3.5 w-3.5" />}
                  <span>
                    {snap.animalId === 'indus_dolphin' && snap.isDiving
                      ? 'Surface'
                      : lang === 'ur'
                        ? activeChar.secondaryAbility.nameUr
                        : activeChar.secondaryAbility.name}
                  </span>
                  <span className="rounded bg-slate-900 px-1.5 py-0.5 text-[10px] text-slate-300">
                    {snap.secondaryCooldown > 0 ? `${snap.secondaryCooldown}s` : activeChar.secondaryAbility.keyHint}
                  </span>
                </button>
                <span className="pl-1 text-[11px] text-slate-400">
                  WASD Move · Shift Sprint · E Call · Esc Pause
                </span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* First-Minute Tutorial Overlay */}
      {snap && snap.phase === 'playing' && showTutorial && (
        <TutorialOverlay
          snap={snap}
          lang={lang}
          onComplete={() => {
            setProg(markTutorialCompleted());
            setShowTutorial(false);
          }}
          onDismiss={() => setShowTutorial(false)}
        />
      )}

      {snap && snap.phase === 'playing' && (
        <TouchControls
          mode={snap.mode}
          animalId={snap.animalId}
          isDiving={snap.isDiving}
          equippedTool={snap.equippedTool}
          telephotoZoomed={snap.telephotoZoomed}
          onMove={(mx, mz, sp) => sceneRef.current?.setTouchControls(mx, mz, sp)}
          onPrimary={() => sceneRef.current?.triggerAction()}
          onSecondary={() => sceneRef.current?.triggerSecondaryAction()}
          onCall={handleCall}
        />
      )}

      {/* Intro Card Modal */}
      {snap && snap.phase === 'intro' && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/75 p-4">
          <div className="w-full max-w-md rounded-2xl border border-emerald-400/35 bg-slate-900 p-6 text-slate-100 shadow-2xl">
            <div className="flex items-center gap-3">
              <MarkhorHillsLogo className="h-10 w-10 shrink-0" />
              <div>
                <div className="text-xs font-semibold text-emerald-300 uppercase">
                  {snap.isDailyExpedition ? `${t.dailyExpedition} · ` : `Round ${snap.round} · `}
                  {MODE_LABELS[snap.mode]} · {BIOMES[snap.biomeId].name}
                </div>
                <h2 className="text-xl font-bold text-white">
                  {lang === 'ur' ? activeChar.nameUr : activeChar.name}
                </h2>
              </div>
            </div>

            <p className="mt-3 text-sm leading-relaxed text-slate-300">
              {snap.mode === 'wild_life' && activeChar.challengeDesc}
              {snap.mode === 'ranger_patrol' &&
                `Patrol ${BIOMES[snap.biomeId].name} with your 3-slot Ranger Toolkit! Switch between Binoculars (1) to scout threats at range, Camera (2) to snap wildlife & poacher evidence, and Tranq Dart (3) to sedate poachers before arresting them up close.`}
              {snap.mode === 'photo_safari' &&
                `Explore ${BIOMES[snap.biomeId].name} as a National Wildlife Photographer—predators won't attack you. Every photo raises the biome's Conservation Meter (+6% to +10%), unlocks Field Guide facts, saves real 3D JPEGs to your Album, and earns S-Rank action & 2× Species of the Day bonuses!`}
            </p>

            <div className="mt-3 space-y-1.5 rounded-xl border border-white/10 bg-slate-950/70 p-3 text-xs">
              {snap.mode === 'ranger_patrol' ? (
                <>
                  <div>
                    <span className="font-semibold text-amber-300">[1] Binoculars · [2] Camera · [3] Tranq Dart:</span>{' '}
                    <span className="text-slate-300">Tap dock or press 1/2/3/Tab to switch tools; Space uses equipped tool.</span>
                  </div>
                  <div>
                    <span className="font-semibold text-emerald-300">Terrain Vault (F):</span>{' '}
                    <span className="text-slate-300">Sprint-jump across ridges &amp; rivers; approach cages &amp; snares to clear.</span>
                  </div>
                </>
              ) : snap.mode === 'photo_safari' ? (
                <>
                  <div>
                    <span className="font-semibold text-sky-300">Snap Photo (Space / Click or Hold Steady):</span>{' '}
                    <span className="text-slate-300">Aim at wildlife to lock reticle, then hit Space/Snap—action poses &amp; close-ups score S-Rank!</span>
                  </div>
                  <div>
                    <span className="font-semibold text-amber-300">2.2× Telephoto (F) &amp; Wildlife Call (E):</span>{' '}
                    <span className="text-slate-300">Zoom in on shy mountain wildlife or press E to make nearby animals pause &amp; face your camera.</span>
                  </div>
                </>
              ) : (
                <>
                  <div>
                    <span className="font-semibold text-emerald-300">
                      {activeChar.primaryAbility.name} ({activeChar.primaryAbility.keyHint}):
                    </span>{' '}
                    <span className="text-slate-300">{activeChar.primaryAbility.description}</span>
                  </div>
                  <div>
                    <span className="font-semibold text-amber-300">
                      {activeChar.secondaryAbility.name} ({activeChar.secondaryAbility.keyHint}):
                    </span>{' '}
                    <span className="text-slate-300">{activeChar.secondaryAbility.description}</span>
                  </div>
                </>
              )}
            </div>

            <div className="mt-5 flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={handleBackToSetup}
                className="inline-flex items-center gap-1.5 rounded-xl border border-white/15 px-4 py-2.5 text-xs font-semibold text-slate-300 hover:bg-white/5"
              >
                <ArrowLeft className="h-4 w-4" />
                {t.back}
              </button>
              <button
                type="button"
                onClick={() => {
                  soundEngine.prewarm();
                  simRef.current?.startFromIntro();
                  if (simRef.current) setSnapshot(simRef.current.getSnapshot());
                }}
                className="inline-flex items-center gap-2 rounded-xl bg-emerald-500 px-6 py-2.5 text-sm font-bold text-slate-950 hover:bg-emerald-400"
              >
                <Play className="h-4 w-4 fill-current" />
                {t.beginRun}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Pause Modal */}
      {snap && snap.phase === 'paused' && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/75 p-4">
          <div className="w-full max-w-sm rounded-2xl border border-white/15 bg-slate-900 p-6 text-center shadow-2xl">
            <h2 className="text-xl font-bold text-white">{t.paused}</h2>
            <p className="mt-1 text-xs text-slate-400">
              {playerName} · {MODE_LABELS[snap.mode]}
            </p>
            <div className="mt-5 space-y-2.5">
              <button
                type="button"
                onClick={() => {
                  simRef.current?.togglePause();
                  if (simRef.current) setSnapshot(simRef.current.getSnapshot());
                }}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-500 py-2.5 text-sm font-bold text-slate-950 hover:bg-emerald-400"
              >
                <Play className="h-4 w-4 fill-current" />
                {t.resume}
              </button>
              <button
                type="button"
                onClick={handleRestart}
                className="flex w-full items-center justify-center gap-2 rounded-xl border border-white/15 bg-slate-800 py-2.5 text-sm font-semibold text-white hover:bg-slate-700"
              >
                <RotateCcw className="h-4 w-4" />
                {t.restartSeed}
              </button>
              <button
                type="button"
                onClick={() => setShowRecords(true)}
                className="flex w-full items-center justify-center gap-2 rounded-xl border border-white/15 bg-slate-800 py-2.5 text-sm font-semibold text-amber-300 hover:bg-slate-700"
              >
                <History className="h-4 w-4" />
                Expedition History
              </button>
              <button
                type="button"
                onClick={handleBackToSetup}
                className="flex w-full items-center justify-center gap-2 rounded-xl border border-white/15 py-2.5 text-sm font-semibold text-slate-300 hover:bg-white/5"
              >
                <ArrowLeft className="h-4 w-4" />
                {t.habitatPicker}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Round Complete / Victory Modal with Conservation Meter Ending */}
      {snap && snap.phase === 'victory' && ending && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/75 p-4">
          <div className="w-full max-w-md rounded-2xl border border-amber-400/45 bg-slate-900 p-6 text-center shadow-2xl">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-500/20 text-amber-300">
              <Trophy className="h-6 w-6" />
            </div>
            <h2 className="mt-3 text-2xl font-bold text-white">
              Rd {snap.round} · {t.roundComplete}
            </h2>
            <p className="mt-1 text-xs text-emerald-300">
              {playerName} · {snap.score} pts · +{snap.xpEarned + 120} XP ·{' '}
              {formatDuration(snap.elapsedSec)}
            </p>
            <p className="mt-2 text-sm text-slate-300">
              {buildRecordSummary({ ...snap, round: snap.round })} in {BIOMES[snap.biomeId].name}.
            </p>

            {snap.mode === 'photo_safari' && (
              <div className="mt-3 rounded-xl border border-sky-400/35 bg-sky-950/35 p-3 text-left text-xs tabular-nums">
                <div className="flex items-center justify-between font-bold text-sky-200">
                  <span>Photo Safari Rarity &amp; Quality Breakdown</span>
                  <span className="text-amber-300">{snap.score} Total pts → Leaderboard</span>
                </div>
                <div className="mt-1.5 grid grid-cols-3 gap-2 text-center">
                  <div className="rounded-lg bg-slate-950/70 px-2 py-1">
                    <div className="text-[10px] text-slate-400">S-Rank Frames</div>
                    <div className="font-bold text-amber-300">{snap.sRankCount}</div>
                  </div>
                  <div className="rounded-lg bg-slate-950/70 px-2 py-1">
                    <div className="text-[10px] text-slate-400">Rare / Legend</div>
                    <div className="font-bold text-sky-300">{snap.rareShotsCount}</div>
                  </div>
                  <div className="rounded-lg bg-slate-950/70 px-2 py-1">
                    <div className="text-[10px] text-slate-400">Field Challenge</div>
                    <div className="font-bold text-emerald-300">
                      {snap.safariChallengeDone ? `+${snap.safariChallengeBonus} ✓` : 'In Progress'}
                    </div>
                  </div>
                </div>
                {snap.bestPhotoLabel && (
                  <div className="mt-1.5 text-[11px] text-slate-300">
                    Best Shot: <span className="font-semibold text-white">{snap.bestPhotoLabel}</span> (+
                    {snap.bestPhotoScore} pts)
                  </div>
                )}
              </div>
            )}

            {/* Conservation Meter Ending Card */}
            <div
              className={`mt-4 rounded-xl border p-3.5 text-left ${
                ending.tier === 'thriving'
                  ? 'border-emerald-400/40 bg-emerald-950/35'
                  : ending.tier === 'recovering'
                    ? 'border-amber-400/40 bg-amber-950/30'
                    : 'border-rose-400/40 bg-rose-950/30'
              }`}
            >
              <div className="flex items-center justify-between text-xs font-bold">
                <span className="text-white">{lang === 'ur' ? ending.titleUr : ending.title}</span>
                <span className="text-emerald-300 tabular-nums">
                  {snap.conservationScore}% ({snap.speciesCount} sp.)
                </span>
              </div>
              <p className="mt-1 text-xs leading-relaxed text-slate-300">
                {lang === 'ur' ? ending.narrativeUr : ending.narrative}
              </p>
            </div>

            <div className="mt-4 rounded-xl border border-sky-400/30 bg-sky-950/25 p-3 text-left text-xs">
              <div className="font-bold text-sky-300">
                Up Next · Round {snap.round + 1}: {snap.nextMissionTitle}
              </div>
              <p className="mt-0.5 text-slate-300">{snap.nextMissionText}</p>
            </div>

            {lastSaveStatus && (
              <div
                className={`mt-3 rounded-lg border px-3 py-1.5 text-[11px] font-medium ${
                  lastSaveStatus.savedToSupabase
                    ? 'border-emerald-400/35 bg-emerald-950/40 text-emerald-200'
                    : 'border-amber-400/35 bg-amber-950/35 text-amber-200'
                }`}
              >
                {lastSaveStatus.savedToSupabase
                  ? 'Saved to Supabase Global Leaderboard & Local Records ✓'
                  : lastSaveStatus.savedToServer
                    ? `Saved to Server & Browser (${lastSaveStatus.note || 'Run supabase/schema.sql in Supabase'})`
                    : 'Saved to Browser LocalStorage (Offline mode)'}
              </div>
            )}

            <div className="mt-4 space-y-2.5">
              <button
                type="button"
                onClick={handleNextRound}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-500 py-3 text-sm font-bold text-slate-950 hover:bg-emerald-400"
              >
                <Play className="h-4 w-4 fill-current" />
                Next Round (Round {snap.round + 1} · {BIOMES[getNextRoundBiome(snap.biomeId, snap.animalId)].name})
              </button>
              <button
                type="button"
                onClick={() => {
                  simRef.current?.resumeExplore();
                  if (simRef.current) setSnapshot(simRef.current.getSnapshot());
                }}
                className="flex w-full items-center justify-center gap-2 rounded-xl border border-emerald-400/40 bg-emerald-500/15 py-2.5 text-sm font-semibold text-emerald-200 hover:bg-emerald-500/25"
              >
                <Compass className="h-4 w-4" />
                {t.keepExploring}
              </button>
              <div className="grid grid-cols-2 gap-2.5">
                <button
                  type="button"
                  onClick={handleRestart}
                  className="flex items-center justify-center gap-1.5 rounded-xl border border-white/15 bg-slate-800 py-2.5 text-xs font-semibold text-white hover:bg-slate-700"
                >
                  <RotateCcw className="h-4 w-4" />
                  Restart Round 1
                </button>
                <button
                  type="button"
                  onClick={handleBackToSetup}
                  className="flex items-center justify-center gap-1.5 rounded-xl border border-white/15 py-2.5 text-xs font-semibold text-slate-300 hover:bg-white/5"
                >
                  <ArrowLeft className="h-4 w-4" />
                  {t.habitatPicker}
                </button>
              </div>
              <button
                type="button"
                onClick={() => setShowFeedbackModal(true)}
                className="flex w-full items-center justify-center gap-2 rounded-xl border border-sky-400/35 bg-sky-500/10 py-2 text-xs font-semibold text-sky-200 hover:bg-sky-500/20"
              >
                <MessageSquarePlus className="h-4 w-4" />
                Give Feedback &amp; Sync to Google Sheet
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Game Over Modal */}
      {snap && snap.phase === 'gameover' && ending && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/80 p-4">
          <div className="w-full max-w-md rounded-2xl border border-rose-400/40 bg-slate-900 p-6 text-center shadow-2xl">
            <h2 className="text-2xl font-bold text-white">{t.wildernessClaimed}</h2>
            <p className="mt-2 text-sm text-rose-300">{snap.failReason}</p>
            <p className="mt-2 text-xs text-slate-400">
              {playerName} · {snap.score} pts · +{snap.xpEarned + 25} XP ·{' '}
              {formatDuration(snap.elapsedSec)}
            </p>
            <div className="mt-3 rounded-xl border border-white/10 bg-slate-950/70 p-3 text-left text-xs text-slate-300">
              <div className="font-bold text-white">
                {lang === 'ur' ? ending.titleUr : ending.title} ({snap.conservationScore}%)
              </div>
              <p className="mt-1">{lang === 'ur' ? ending.narrativeUr : ending.narrative}</p>
            </div>
            {lastSaveStatus && (
              <div
                className={`mt-3 rounded-lg border px-3 py-1.5 text-[11px] font-medium ${
                  lastSaveStatus.savedToSupabase
                    ? 'border-emerald-400/35 bg-emerald-950/40 text-emerald-200'
                    : 'border-amber-400/35 bg-amber-950/35 text-amber-200'
                }`}
              >
                {lastSaveStatus.savedToSupabase
                  ? 'Saved to Supabase Global Leaderboard ✓'
                  : lastSaveStatus.savedToServer
                    ? `Saved to Server & Browser (${lastSaveStatus.note || 'Run supabase/schema.sql'})`
                    : 'Saved to Browser LocalStorage'}
              </div>
            )}
            <div className="mt-6 grid grid-cols-2 gap-2.5">
              <button
                type="button"
                onClick={handleRestart}
                className="flex items-center justify-center gap-1.5 rounded-xl bg-emerald-500 py-2.5 text-sm font-bold text-slate-950 hover:bg-emerald-400"
              >
                <RotateCcw className="h-4 w-4" />
                {t.tryAgain}
              </button>
              <button
                type="button"
                onClick={handleBackToSetup}
                className="flex items-center justify-center gap-1.5 rounded-xl border border-white/15 py-2.5 text-sm font-semibold text-slate-200 hover:bg-white/5"
              >
                <ArrowLeft className="h-4 w-4" />
                {t.habitatPicker}
              </button>
            </div>
            <button
              type="button"
              onClick={() => setShowFeedbackModal(true)}
              className="mt-2.5 flex w-full items-center justify-center gap-2 rounded-xl border border-sky-400/35 bg-sky-500/10 py-2 text-xs font-semibold text-sky-200 hover:bg-sky-500/20"
            >
              <MessageSquarePlus className="h-4 w-4" />
              Give Feedback &amp; Sync to Google Sheet
            </button>
          </div>
        </div>
      )}

      {showFieldGuide && snap && (
        <FieldGuideModal
          photographedIds={snap.photographedSpecies}
          onClose={() => setShowFieldGuide(false)}
        />
      )}
      {showAlbum && (
        <PhotoAlbumModal
          photos={savedPhotos}
          lang={lang}
          onPhotosChange={setSavedPhotos}
          onClose={() => setShowAlbum(false)}
        />
      )}
      {showRecords && <RecordsModal records={records} onClose={() => setShowRecords(false)} />}
      {showAuthModal && (
        <AuthModal
          account={account}
          onAuthChange={(next) => {
            setAccount(next);
            setProg(loadProgression());
            if (next?.rangerName) setPlayerName(next.rangerName);
          }}
          onClose={() => setShowAuthModal(false)}
        />
      )}
      {showFeedbackModal && snap && (
        <FeedbackModal
          playerName={playerName}
          account={account}
          mode={snap.mode}
          animalId={snap.animalId}
          biomeId={snap.biomeId}
          round={snap.round}
          score={snap.score}
          victory={snap.phase === 'victory'}
          onAuthChange={(next) => {
            setAccount(next);
            if (next?.rangerName) setPlayerName(next.rangerName);
          }}
          onClose={() => setShowFeedbackModal(false)}
        />
      )}
    </div>
  );
}

function StatBar({
  label,
  value,
  color,
  icon,
}: {
  label: string;
  value: number;
  color: string;
  icon?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2">
      <div className="flex w-14 items-center gap-1 text-[10px] text-slate-300">
        {icon}
        <span>{label}</span>
      </div>
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-800">
        <div
          className={`h-full ${color}`}
          style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
        />
      </div>
      <div className="w-7 text-right text-[10px] font-semibold text-slate-200 tabular-nums">
        {value}
      </div>
    </div>
  );
}
