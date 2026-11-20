import { useEffect, useMemo, useState } from 'react';
import {
  ArrowRight,
  Award,
  Calendar,
  Camera,
  Check,
  ChevronDown,
  Clock,
  Compass,
  Copy,
  Database,
  Globe,
  MapPin,
  PawPrint,
  Play,
  RefreshCw,
  Shield,
  ShieldCheck,
  Sparkles,
  Trophy,
  MessageSquarePlus,
  Share2,
  UserCheck,
  UserCircle2,
} from 'lucide-react';
import { FeedbackModal } from '../components/FeedbackModal';
import { LandingFlythrough } from '../components/LandingFlythrough';
import { MarkhorHillsLogo } from '../components/MarkhorHillsLogo';
import { PhotoAlbumModal } from '../components/PhotoAlbumModal';
import { PWAInstallButton } from '../components/PWAInstallButton';
import { ANIMALS, PLAYABLE_WILDLIFE } from '../data/animals';
import { AuthAccount, fetchJsonSafe } from '../data/auth';
import { BIOMES, BIOME_LIST } from '../data/biomes';
import { loadConservationMap } from '../data/conservation';
import {
  getDailyExpedition,
  getSpeciesOfTheDay,
  getTimeUntilNextDaily,
  getWeeklyChallenge,
  getWeeklyChallengePool,
} from '../data/dailyExpedition';
import { COPY, useLanguage } from '../data/i18n';
import { loadSavedPhotos } from '../data/photos';
import { loadProgression } from '../data/progression';
import {
  BoardScope,
  LEADERBOARD_SCHEMA_SQL,
  MODE_LABELS,
  SupabaseStatusResult,
  fetchSharedLeaderboard,
  formatDuration,
  getTopLeaderboard,
  verifyAndSyncSupabase,
} from '../data/records';
import { BiomeId, GameMode, PlayerRecord, SavedPhotoEntry } from '../types/game';

interface LandingPageProps {
  account: AuthAccount | null;
  onOpenAuth: () => void;
  onNavigateGame: (presetMode?: GameMode, opts?: { daily?: boolean }) => void;
}

export const LANDING_FAQS = [
  {
    q: 'What is Wild Pakistan – The Last Wilderness?',
    a: 'Wild Pakistan – The Last Wilderness is a free, browser-based 3D wildlife survival and conservation game set across five Pakistani ecosystems: Northern Mountains, Deosai Plateau, Ziarat Juniper Forest, Indus River, and Thar Desert.',
  },
  {
    q: 'What special abilities and challenges does each animal have?',
    a: 'Markhor leaps off hills and defends itself with Horn Charge against attacking Snow Leopards and Shikaris; Snow Leopard stalks and pounces onto spotted prey; Himalayan Brown Bear unleashes Ground Slam and Thunder Roar; Indus River Dolphin breaches high above illegal Jaal nets or deep-dives underneath while managing oxygen.',
  },
  {
    q: 'How do Daily Expeditions, Conservation Meter, and Co-op Squads work?',
    a: 'Every UTC day unlocks one shared Daily Expedition seed and a Species of the Day spotlight. Arresting poachers, rescuing wildlife, and taking photos raises each biome’s Conservation Meter toward the Thriving Sanctuary ending, while Co-op Squads let rangers or packs team up live.',
  },
  {
    q: 'Can I install it on my phone or play offline?',
    a: 'Yes! Wild Pakistan is an installable Progressive Web App (PWA) with offline support on Android, iOS Safari, and desktop browsers, complete with bilingual English & Urdu interface and touch controls.',
  },
  {
    q: 'How do records and the Hall of Rangers leaderboard work?',
    a: 'Every run saves locally and syncs to the shared Hall of Rangers (All-Time, Daily, and Weekly boards via Supabase PostgreSQL or live server when connected).',
  },
  {
    q: 'How does Photo Safari Rarity × Quality scoring work?',
    a: 'Photo Safari multiplies each animal species rarity (Common 100 pts, Rare 220 pts, Legendary 400 pts for Snow Leopard and Indus Dolphin) by composition grade (S-Rank 2.0× down to C-Rank 0.7×), plus Species of the Day 2× bonuses and rotating Field Challenges.',
  },
  {
    q: 'Can I create a free account and submit game feedback?',
    a: 'Yes! Create a free Ranger account with Email & Password (zero confirmation emails) to unlock gameplay, sync your XP and wildlife unlocks in Supabase PostgreSQL, and submit post-game ratings and comments backed up to Supabase and Google Sheets.',
  },
];

export function LandingPage({ account, onOpenAuth, onNavigateGame }: LandingPageProps) {
  const [lang, setLang] = useLanguage();
  const t = COPY[lang];

  const [flyBiome, setFlyBiome] = useState<BiomeId>('northern_mountains');
  const [boardFilter, setBoardFilter] = useState<GameMode | 'all'>('all');
  const [boardScope, setBoardScope] = useState<BoardScope>('all');
  const [leaderboard, setLeaderboard] = useState<PlayerRecord[]>(() =>
    getTopLeaderboard('all', 8, 'all'),
  );
  const [boardSource, setBoardSource] = useState<'supabase' | 'server' | 'local'>('local');
  const [boardNote, setBoardNote] = useState<string>('');
  const [sbStatus, setSbStatus] = useState<SupabaseStatusResult | null>(null);
  const [sbChecking, setSbChecking] = useState(false);
  const [copiedSql, setCopiedSql] = useState(false);
  const [openFaq, setOpenFaq] = useState<number | null>(0);
  const [showAlbum, setShowAlbum] = useState(false);
  const [showFeedbackModal, setShowFeedbackModal] = useState(false);
  const [savedPhotos, setSavedPhotos] = useState<SavedPhotoEntry[]>(() => loadSavedPhotos());
  const [inviteCopied, setInviteCopied] = useState(false);

  const handleShareGame = async () => {
    const shareUrl = window.location.origin + window.location.pathname;
    if (navigator.share) {
      try {
        await navigator.share({
          title: 'Wild Pakistan – The Last Wilderness',
          text: 'Play free 3D wildlife survival, Ranger Patrol & Photo Safari across Pakistan!',
          url: shareUrl,
        });
        return;
      } catch {
        // Fallback to clipboard copy
      }
    }
    try {
      await navigator.clipboard.writeText(shareUrl);
      setInviteCopied(true);
      window.setTimeout(() => setInviteCopied(false), 2400);
    } catch {
      // Ignore restricted clipboard
    }
  };

  const daily = useMemo(() => getDailyExpedition(), []);
  const speciesOfDay = useMemo(() => getSpeciesOfTheDay(), []);
  const weekly = useMemo(() => getWeeklyChallenge(), []);
  const weeklyPool = useMemo(() => getWeeklyChallengePool(), []);
  const [countdown, setCountdown] = useState(() => getTimeUntilNextDaily());
  const conservationMap = useMemo(() => loadConservationMap(), []);
  const prog = useMemo(() => loadProgression(), []);
  const weeklyStats = prog.weeklyCounters[weekly.weekKey] ?? {
    orbs: 0,
    arrests: 0,
    photos: 0,
    runs: 0,
  };

  useEffect(() => {
    const timer = window.setInterval(() => setCountdown(getTimeUntilNextDaily()), 60000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    let active = true;
    fetchSharedLeaderboard(boardScope, boardFilter, 8).then((res) => {
      if (!active) return;
      setLeaderboard(res.records);
      setBoardSource(res.source);
      setBoardNote(res.supabaseNote || '');
    });
    return () => {
      active = false;
    };
  }, [boardScope, boardFilter]);

  useEffect(() => {
    let active = true;
    fetchJsonSafe<{
      records?: number;
      supabase?: { configured: boolean; connected: boolean; note: string };
    }>('/api/health').then((res) => {
      if (!active || !res.ok || !res.data?.supabase) return;
      const health = res.data;
      setSbStatus({
        configured: health.supabase!.configured,
        connected: health.supabase!.connected,
        tableReady: health.supabase!.connected,
        syncedCount: 0,
        totalServerRecords: health.records,
        schemaSql: LEADERBOARD_SCHEMA_SQL,
        note: health.supabase!.note,
      });
    });
    return () => {
      active = false;
    };
  }, []);

  const handleVerifyAndSync = async () => {
    setSbChecking(true);
    try {
      const res = await verifyAndSyncSupabase();
      setSbStatus(res);
      const refreshed = await fetchSharedLeaderboard(boardScope, boardFilter, 8);
      setLeaderboard(refreshed.records);
      setBoardSource(refreshed.source);
      setBoardNote(refreshed.supabaseNote || '');
    } finally {
      setSbChecking(false);
    }
  };

  const handleCopySchema = async () => {
    const sql = sbStatus?.schemaSql || LEADERBOARD_SCHEMA_SQL;
    try {
      await navigator.clipboard.writeText(sql);
      setCopiedSql(true);
      window.setTimeout(() => setCopiedSql(false), 2500);
    } catch {
      // Clipboard blocked in restricted frame; ignore cleanly
    }
  };

  return (
    <div className="relative min-h-screen bg-slate-950 text-slate-100 selection:bg-emerald-400 selection:text-slate-950">
      <LandingFlythrough biomeId={flyBiome} />

      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 z-10 bg-gradient-to-b from-slate-950/65 via-slate-950/45 to-slate-950/95"
      />

      <div className="relative z-20">
        {/* Top Header */}
        <header className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-5 py-5">
          <div className="flex items-center gap-3">
            <MarkhorHillsLogo className="h-12 w-12 shrink-0" />
            <div>
              <div className="text-sm font-bold tracking-wider text-white uppercase">
                {t.brandTitle}
              </div>
              <div className="text-[11px] tracking-widest text-emerald-300 uppercase">
                {t.brandSubtitle}
              </div>
            </div>
          </div>

          <nav className="hidden items-center gap-6 text-sm text-slate-200 lg:flex">
            <a href="#daily-expedition" className="hover:text-emerald-300">
              {t.dailyExpedition}
            </a>
            <a href="#modes" className="hover:text-emerald-300">
              {lang === 'ur' ? 'موڈز' : 'Modes'}
            </a>
            <a href="#biomes" className="hover:text-emerald-300">
              {lang === 'ur' ? 'علاقے اور تحفظ' : 'Biomes & Conservation'}
            </a>
            <a href="#hall-of-rangers" className="hover:text-emerald-300">
              {t.hallOfRangers}
            </a>
          </nav>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setLang(lang === 'en' ? 'ur' : 'en')}
              className="inline-flex items-center gap-1.5 rounded-xl border border-white/20 bg-slate-900/90 px-3 py-2 text-xs font-semibold text-slate-100 hover:border-emerald-400/50"
              title="Switch English / اردو"
            >
              <Globe className="h-3.5 w-3.5 text-emerald-300" />
              <span>{lang === 'en' ? 'اردو' : 'EN'}</span>
            </button>

            <button
              type="button"
              onClick={() => setShowAlbum(true)}
              className="inline-flex items-center gap-1.5 rounded-xl border border-sky-400/35 bg-slate-900/90 px-3 py-2 text-xs font-semibold text-sky-200 hover:border-sky-300"
            >
              <Camera className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">{t.photoAlbum}</span>
              <span className="rounded bg-sky-500/20 px-1.5 py-0.5 text-[10px]">
                {savedPhotos.length}
              </span>
            </button>

            <PWAInstallButton lang={lang} />

            {/* Combined Account & Play Free Bar */}
            <div className="inline-flex items-center overflow-hidden rounded-xl border border-emerald-400/45 bg-slate-900/95 shadow-lg">
              <button
                type="button"
                onClick={onOpenAuth}
                className="inline-flex items-center gap-1.5 px-3 py-2.5 text-xs font-semibold text-slate-100 hover:bg-slate-800"
              >
                {account ? (
                  <>
                    <UserCheck className="h-3.5 w-3.5 text-emerald-300" />
                    <span className="max-w-[110px] truncate">{account.rangerName}</span>
                  </>
                ) : (
                  <>
                    <UserCircle2 className="h-3.5 w-3.5 text-emerald-300" />
                    <span>Login / Save Info</span>
                  </>
                )}
              </button>
              <a
                href="./game/"
                onClick={(e) => {
                  e.preventDefault();
                  onNavigateGame();
                }}
                className="inline-flex items-center gap-1.5 bg-emerald-500 px-4 py-2.5 text-sm font-bold text-slate-950 transition-colors hover:bg-emerald-400"
              >
                <Play className="h-4 w-4 fill-current" />
                {t.playFree}
              </a>
            </div>
          </div>
        </header>

        {/* Hero Section */}
        <section className="mx-auto flex min-h-[72vh] max-w-6xl flex-col justify-center px-5 pb-12 pt-6">
          <div className="max-w-2xl">
            <div className="inline-flex items-center gap-2 rounded-lg border border-emerald-400/35 bg-slate-950/80 px-3 py-1.5 text-xs font-semibold tracking-wide text-emerald-300">
              <Sparkles className="h-3.5 w-3.5" />
              {lang === 'ur'
                ? 'پاکستان کے 5 قدرتی علاقوں کا مفت تھری ڈی سفر'
                : '3D Browser Wildlife Survival, Co-op & Conservation'}
            </div>

            <h1 className="mt-5 text-4xl font-extrabold tracking-tight text-white sm:text-6xl">
              {t.brandTitle}
              <span className="mt-1 block bg-gradient-to-r from-emerald-300 via-teal-200 to-amber-300 bg-clip-text text-transparent">
                {t.brandSubtitle}
              </span>
            </h1>

            <p className="mt-5 max-w-xl text-base leading-relaxed text-slate-200 sm:text-lg">
              {lang === 'ur'
                ? 'مارخور بن کر پہاڑوں سے چھلانگ لگائیں اور حملہ آور چیتے کو سینگ مار کر بچیں، برفانی چیتے کی طرح شکار کریں، اندھی ڈولفن بن کر جال سے بچیں، یا رینجر گشت میں شکاریوں کو پکڑیں۔'
                : 'Leap off cliffs as a Markhor and horn-strike attacking leopards, pounce prey as a Snow Leopard, breach or deep-dive around Jaals as an Indus Dolphin, or patrol co-op with Wildlife Rangers.'}
            </p>

            <div className="mt-8 flex flex-wrap items-center gap-3.5">
              <a
                href="./game/"
                onClick={(e) => {
                  e.preventDefault();
                  onNavigateGame();
                }}
                className="inline-flex items-center gap-2.5 rounded-xl bg-emerald-500 px-7 py-4 text-base font-bold text-slate-950 shadow-xl transition-transform hover:scale-[1.02] hover:bg-emerald-400"
              >
                <Play className="h-5 w-5 fill-current" />
                {t.enterWilderness}
                <ArrowRight className="h-4 w-4" />
              </a>

              <button
                type="button"
                onClick={() => onNavigateGame(daily.mode, { daily: true })}
                className="inline-flex items-center gap-2 rounded-xl border border-amber-400/45 bg-amber-500/15 px-5 py-4 text-sm font-bold text-amber-200 hover:bg-amber-500/25"
              >
                <Calendar className="h-4 w-4 text-amber-300" />
                {t.playDaily}
              </button>

              <a
                href="#hall-of-rangers"
                className="inline-flex items-center gap-2 rounded-xl border border-white/20 bg-slate-950/80 px-5 py-4 text-sm font-semibold text-white hover:border-emerald-400/50 hover:text-emerald-200"
              >
                <Trophy className="h-4 w-4 text-amber-300" />
                {t.hallOfRangers}
              </a>

              <button
                type="button"
                onClick={handleShareGame}
                className="inline-flex items-center gap-2 rounded-xl border border-sky-400/35 bg-sky-500/10 px-4 py-4 text-sm font-semibold text-sky-200 hover:bg-sky-500/20"
              >
                {inviteCopied ? (
                  <>
                    <Check className="h-4 w-4 text-emerald-300" />
                    <span>Invite Link Copied!</span>
                  </>
                ) : (
                  <>
                    <Share2 className="h-4 w-4" />
                    <span>{lang === 'ur' ? 'دوستوں کو بلائیں' : 'Invite Friends'}</span>
                  </>
                )}
              </button>
            </div>

            <div className="mt-10">
              <div className="mb-2 text-xs font-medium tracking-wider text-slate-300 uppercase">
                {lang === 'ur' ? 'براہِ راست 3D منظر منتخب کریں' : 'Live 3D Flythrough Backdrop'}
              </div>
              <div className="flex flex-wrap gap-2">
                {BIOME_LIST.map((b) => (
                  <button
                    key={b.id}
                    type="button"
                    onClick={() => setFlyBiome(b.id)}
                    className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                      flyBiome === b.id
                        ? 'border-emerald-400 bg-emerald-500/25 text-emerald-200'
                        : 'border-white/15 bg-slate-950/75 text-slate-300 hover:border-white/30'
                    }`}
                  >
                    {lang === 'ur' ? b.nameUr : b.name}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* Daily Expedition + Species of the Day + Weekly Challenge */}
        <section id="daily-expedition" className="mx-auto max-w-6xl px-5 py-8">
          <div className="grid gap-5 lg:grid-cols-3">
            {/* Shared Daily Map */}
            <div className="flex flex-col justify-between rounded-2xl border border-amber-400/35 bg-slate-900/95 p-6 lg:col-span-2">
              <div>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="inline-flex items-center gap-2 rounded-lg bg-amber-500/15 px-3 py-1 text-xs font-bold text-amber-300">
                    <Calendar className="h-3.5 w-3.5" />
                    <span>
                      {t.dailyExpedition} · {daily.dateKey}
                    </span>
                  </div>
                  <div className="inline-flex items-center gap-1 text-xs text-slate-300 tabular-nums">
                    <Clock className="h-3.5 w-3.5 text-amber-300" />
                    <span>Resets in {countdown}</span>
                  </div>
                </div>

                <h2 className="mt-3 text-xl font-bold text-white sm:text-2xl">
                  {lang === 'ur' ? daily.titleUr : daily.title}
                </h2>
                <p className="mt-1.5 text-sm text-slate-300">
                  {lang === 'ur' ? daily.goalTextUr : daily.goalText}
                </p>

                <div className="mt-4 space-y-2.5">
                  <div className="text-xs font-bold tracking-wider text-emerald-300 uppercase">
                    {t.weeklyChallenge}s ({weekly.weekKey})
                  </div>
                  <div className="grid gap-2.5 sm:grid-cols-3">
                    {weeklyPool.map((wc) => {
                      const val = weeklyStats[wc.metric] ?? 0;
                      const isFeatured = wc.metric === weekly.metric;
                      return (
                        <div
                          key={wc.title}
                          className={`rounded-xl border p-3 ${
                            isFeatured
                              ? 'border-emerald-400/45 bg-emerald-950/30'
                              : 'border-white/10 bg-slate-950/70'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-1 text-[11px]">
                            <span className="truncate font-semibold text-white">
                              {lang === 'ur' ? wc.titleUr : wc.title}
                            </span>
                            <span className="shrink-0 font-bold text-amber-300 tabular-nums">
                              +{wc.rewardXp} XP
                            </span>
                          </div>
                          <p className="mt-1 text-[11px] leading-snug text-slate-400">
                            {lang === 'ur' ? wc.descriptionUr : wc.description}
                          </p>
                          <div className="mt-2 flex items-center gap-2">
                            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-800">
                              <div
                                className="h-full bg-emerald-400"
                                style={{
                                  width: `${Math.min(100, (val / wc.targetCount) * 100)}%`,
                                }}
                              />
                            </div>
                            <span className="text-[10px] font-bold text-emerald-300 tabular-nums">
                              {Math.min(val, wc.targetCount)}/{wc.targetCount}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>

              <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
                <span className="text-xs font-semibold text-emerald-300">
                  +150 Bonus XP · Shared Global Map Seed #{daily.seed % 10000}
                </span>
                <button
                  type="button"
                  onClick={() => onNavigateGame(daily.mode, { daily: true })}
                  className="inline-flex items-center gap-2 rounded-xl bg-amber-400 px-5 py-2.5 text-sm font-bold text-slate-950 hover:bg-amber-300"
                >
                  <Play className="h-4 w-4 fill-current" />
                  {t.playDaily}
                </button>
              </div>
            </div>

            {/* Species of the Day */}
            <div className="flex flex-col justify-between rounded-2xl border border-sky-400/30 bg-slate-900/95 p-6">
              <div>
                <div className="inline-flex items-center gap-1.5 rounded-lg bg-sky-500/15 px-3 py-1 text-xs font-bold text-sky-300">
                  <Camera className="h-3.5 w-3.5" />
                  <span>{t.speciesOfDay}</span>
                </div>
                <h3 className="mt-3 text-xl font-bold text-white">
                  {lang === 'ur' ? speciesOfDay.species.nameUr : speciesOfDay.species.name}
                </h3>
                <div className="text-xs italic text-slate-400">
                  {speciesOfDay.species.scientificName} · {speciesOfDay.species.status}
                </div>
                <p className="mt-3 text-xs leading-relaxed text-slate-300">
                  {speciesOfDay.species.fact}
                </p>
              </div>
              <div className="mt-4 flex items-center justify-between border-t border-white/10 pt-3 text-xs">
                <span className="text-emerald-300">
                  {lang === 'ur' ? speciesOfDay.biome.nameUr : speciesOfDay.biome.name}
                </span>
                <button
                  type="button"
                  onClick={() => onNavigateGame('photo_safari')}
                  className="font-semibold text-sky-300 hover:text-sky-200"
                >
                  {lang === 'ur' ? 'تصویر کھینچیں ←' : 'Photograph in Safari →'}
                </button>
              </div>
            </div>
          </div>
        </section>

        {/* Three Modes */}
        <section id="modes" className="mx-auto max-w-6xl px-5 py-12">
          <div className="mb-8">
            <h2 className="text-2xl font-bold text-white sm:text-3xl">
              {lang === 'ur' ? 'تین منفرد گیم موڈز' : 'Three Ways to Experience the Wild'}
            </h2>
            <p className="mt-2 text-sm text-slate-300">
              {lang === 'ur'
                ? '1 سے 2 منٹ کے تیز مراحل، ہر مرحلے میں نیا مشن، موسمی ہجرت اور کو-آپ ملٹی پلیئر۔'
                : 'Crisp 1–2 minute rounds with fresh missions every round, expanded biomes, seasonal migration, and live Co-op squads.'}
            </p>
          </div>

          <div className="grid gap-5 md:grid-cols-3">
            <div className="flex flex-col justify-between rounded-2xl border border-emerald-400/25 bg-slate-900/95 p-6">
              <div>
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-500/20 text-emerald-300">
                  <PawPrint className="h-6 w-6" />
                </div>
                <h3 className="mt-4 text-xl font-bold text-white">{t.modes.wild_life}</h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-300">
                  Grow from Cub to Adult! Leap cliffs, horn-strike attacking leopards to flee safely, dodge Shikari rifle fire, and clear 1–2 min mission rounds.
                </p>
              </div>
              <button
                type="button"
                onClick={() => onNavigateGame('wild_life')}
                className="mt-6 inline-flex items-center gap-2 text-sm font-semibold text-emerald-300 hover:text-emerald-200"
              >
                Play {t.modes.wild_life} <ArrowRight className="h-4 w-4" />
              </button>
            </div>

            <div className="flex flex-col justify-between rounded-2xl border border-amber-400/25 bg-slate-900/95 p-6">
              <div>
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-amber-500/20 text-amber-300">
                  <Shield className="h-6 w-6" />
                </div>
                <h3 className="mt-4 text-xl font-bold text-white">{t.modes.ranger_patrol}</h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-300">
                  Patrol solo or with fellow Rangers in Co-op Squads: swim rivers, dart poachers, rescue caged animals, and lift biome Conservation %!
                </p>
              </div>
              <button
                type="button"
                onClick={() => onNavigateGame('ranger_patrol')}
                className="mt-6 inline-flex items-center gap-2 text-sm font-semibold text-amber-300 hover:text-amber-200"
              >
                Play {t.modes.ranger_patrol} <ArrowRight className="h-4 w-4" />
              </button>
            </div>

            <div className="flex flex-col justify-between rounded-2xl border border-sky-400/25 bg-slate-900/95 p-6">
              <div>
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-sky-500/20 text-sky-300">
                  <Camera className="h-6 w-6" />
                </div>
                <h3 className="mt-4 text-xl font-bold text-white">{t.modes.photo_safari}</h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-300">
                  Hold steady to capture real 3D snapshots into your shareable Photo Album while predators leave photographers undisturbed.
                </p>
              </div>
              <button
                type="button"
                onClick={() => onNavigateGame('photo_safari')}
                className="mt-6 inline-flex items-center gap-2 text-sm font-semibold text-sky-300 hover:text-sky-200"
              >
                Play {t.modes.photo_safari} <ArrowRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        </section>

        {/* Biomes Conservation Meter & Animal Abilities Showcase */}
        <section id="biomes" className="mx-auto max-w-6xl px-5 py-12">
          <h2 className="text-2xl font-bold text-white sm:text-3xl">
            {lang === 'ur'
              ? 'پاکستانی جنگلات، تحفظِ حیات میٹر اور صلاحیتیں'
              : 'Five Expanded Biomes, Conservation Meter & Abilities'}
          </h2>

          {/* Markhor Feature Banner */}
          <div className="mt-6 grid overflow-hidden rounded-3xl border border-amber-400/30 bg-slate-900/95 md:grid-cols-5">
            <div className="md:col-span-2">
              <img
                src="./assets/aistudio/animal_9593a91f.png"
                alt="Markhor standing proudly on a mountain ridge overlooking snowy Pakistani peaks"
                className="h-56 w-full object-cover md:h-full"
              />
            </div>
            <div className="flex flex-col justify-center p-6 md:col-span-3">
              <div className="inline-flex w-fit items-center gap-2 rounded-lg bg-amber-500/15 px-3 py-1 text-xs font-semibold text-amber-300">
                National Animal Spotlight · Capra falconeri
              </div>
              <h3 className="mt-3 text-2xl font-bold text-white">
                {lang === 'ur'
                  ? 'مارخور — بلند پہاڑوں کا بادشاہ'
                  : 'Markhor — Crown of the High Hills'}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-300">
                {lang === 'ur'
                  ? 'جب برفانی چیتا یا شکاری حملہ کرے تو F دبا کر سینگوں سے وار کریں اور تیزی سے بھاگ کر اپنی حفاظت کریں۔ سردیوں میں وادیوں اور گرمیوں میں چوٹیوں پر ہجرت کریں۔'
                  : 'Launch into Hill Leaps across ridges, migrate down valleys in winter & up crags in summer, and Horn Charge (F) attacking Snow Leopards so they recoil & flee while you sprint away!'}
              </p>
              <div className="mt-4 flex flex-wrap gap-2 text-xs">
                <span className="rounded-lg border border-emerald-400/30 bg-emerald-500/15 px-3 py-1 text-emerald-200">
                  Space: Hill Leap
                </span>
                <span className="rounded-lg border border-amber-400/30 bg-amber-500/15 px-3 py-1 text-amber-200">
                  F: Horn Charge + Escape Boost
                </span>
              </div>
            </div>
          </div>

          {/* Biome Conservation Cards */}
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            {BIOME_LIST.map((b) => {
              const cState = conservationMap[b.id];
              return (
                <div
                  key={b.id}
                  className="flex flex-col justify-between rounded-2xl border border-white/10 bg-slate-900/90 p-4"
                >
                  <div>
                    <div className="flex items-center gap-1.5 text-xs font-semibold text-emerald-300">
                      <MapPin className="h-3.5 w-3.5" />
                      {b.region.split(',')[0]}
                    </div>
                    <h3 className="mt-1.5 text-base font-bold text-white">
                      {lang === 'ur' ? b.nameUr : b.name}
                    </h3>
                    <p className="mt-1 text-xs leading-relaxed text-slate-300">{b.tagline}</p>
                  </div>

                  <div className="mt-3 border-t border-white/10 pt-2.5">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="inline-flex items-center gap-1 text-slate-400">
                        <ShieldCheck className="h-3 w-3 text-emerald-300" />
                        {cState.speciesCount} species
                      </span>
                      <span className="font-bold text-emerald-300 tabular-nums">
                        {cState.conservationScore}%
                      </span>
                    </div>
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-800">
                      <div
                        className={`h-full ${
                          cState.conservationScore >= 80
                            ? 'bg-emerald-400'
                            : cState.conservationScore >= 50
                              ? 'bg-amber-400'
                              : 'bg-rose-400'
                        }`}
                        style={{ width: `${cState.conservationScore}%` }}
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Playable Wildlife Roster */}
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {PLAYABLE_WILDLIFE.map((a) => (
              <div
                key={a.id}
                className="flex flex-col justify-between rounded-2xl border border-white/10 bg-slate-900/90 p-4"
              >
                <div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-bold text-white">
                      {lang === 'ur' ? a.nameUr : a.name}
                    </span>
                    <span className="rounded bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold text-emerald-300">
                      {a.unlockXp === 0 ? 'Unlocked' : `${a.unlockXp} XP`}
                    </span>
                  </div>
                  <div className="text-[11px] italic text-slate-400">{a.scientificName}</div>
                  <p className="mt-2 text-xs text-slate-300">{a.challengeDesc}</p>
                </div>
                <div className="mt-3 space-y-1 border-t border-white/10 pt-2.5 text-[11px]">
                  <div className="text-emerald-300">
                    <strong>{a.primaryAbility.keyHint}:</strong> {a.primaryAbility.name}
                  </div>
                  <div className="text-amber-300">
                    <strong>{a.secondaryAbility.keyHint}:</strong> {a.secondaryAbility.name}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Hall of Rangers Shared Leaderboard */}
        <section id="hall-of-rangers" className="mx-auto max-w-6xl px-5 py-12">
          <div className="rounded-3xl border border-amber-400/25 bg-slate-900/95 p-6 sm:p-8">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-amber-500/20 text-amber-300">
                  <Award className="h-6 w-6" />
                </div>
                <div>
                  <h2 className="text-2xl font-bold text-white">{t.hallOfRangers}</h2>
                  <p className="text-xs text-slate-400">
                    {boardSource === 'supabase'
                      ? 'Connected to Supabase Global Leaderboard (All-Time · Daily · Weekly)'
                      : boardSource === 'server'
                        ? boardNote || 'Synced with Live Server (Run supabase/schema.sql to enable Supabase table)'
                        : 'Local Device Records (Supabase ready)'}
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                {/* Daily / Weekly / All-Time Tabs */}
                <div className="flex rounded-lg border border-white/10 bg-slate-950 p-0.5">
                  {(
                    [
                      { id: 'all', label: t.allTimeLeaderboard },
                      { id: 'daily', label: t.dailyLeaderboard },
                      { id: 'weekly', label: t.weeklyLeaderboard },
                    ] as Array<{ id: BoardScope; label: string }>
                  ).map((sc) => (
                    <button
                      key={sc.id}
                      type="button"
                      onClick={() => setBoardScope(sc.id)}
                      className={`rounded-md px-2.5 py-1 text-xs font-semibold ${
                        boardScope === sc.id
                          ? 'bg-emerald-500 text-slate-950'
                          : 'text-slate-300 hover:text-white'
                      }`}
                    >
                      {sc.label}
                    </button>
                  ))}
                </div>

                {/* Mode Filter */}
                <div className="flex flex-wrap gap-1">
                  {(['all', 'wild_life', 'ranger_patrol', 'photo_safari'] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setBoardFilter(m)}
                      className={`rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-colors ${
                        boardFilter === m
                          ? 'bg-amber-400 text-slate-950'
                          : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                      }`}
                    >
                      {m === 'all' ? 'All Modes' : MODE_LABELS[m]}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Live Supabase Connection Verification Banner */}
            <div
              className={`mt-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl border px-4 py-3 text-xs ${
                boardSource === 'supabase' || sbStatus?.connected
                  ? 'border-emerald-400/35 bg-emerald-950/30 text-emerald-100'
                  : 'border-amber-400/35 bg-amber-950/25 text-amber-100'
              }`}
            >
              <div className="flex items-start gap-2.5">
                <Database
                  className={`mt-0.5 h-4 w-4 shrink-0 ${
                    boardSource === 'supabase' || sbStatus?.connected
                      ? 'text-emerald-300'
                      : 'text-amber-300'
                  }`}
                />
                <div>
                  <div className="font-bold">
                    {boardSource === 'supabase' || sbStatus?.connected
                      ? 'Supabase Connected & Saving Live (public.leaderboard_entries)'
                      : sbStatus?.configured
                        ? 'Supabase Credentials Found — Waiting for public.leaderboard_entries Table'
                        : 'Local & Server Storage Active'}
                  </div>
                  <p className="mt-0.5 text-[11px] opacity-90">
                    {sbStatus?.note ||
                      boardNote ||
                      'Runs save immediately to server memory & browser storage.'}
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {!(boardSource === 'supabase' || sbStatus?.connected) && (
                  <button
                    type="button"
                    onClick={handleCopySchema}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-amber-400/40 bg-slate-950/75 px-3 py-1.5 text-[11px] font-semibold text-amber-200 hover:bg-slate-900"
                  >
                    {copiedSql ? (
                      <>
                        <Check className="h-3.5 w-3.5 text-emerald-300" />
                        <span>Copied SQL ✓</span>
                      </>
                    ) : (
                      <>
                        <Copy className="h-3.5 w-3.5" />
                        <span>Copy supabase/schema.sql</span>
                      </>
                    )}
                  </button>
                )}
                <button
                  type="button"
                  disabled={sbChecking}
                  onClick={handleVerifyAndSync}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-white/20 bg-slate-950/85 px-3 py-1.5 text-[11px] font-semibold text-white hover:border-emerald-400/50 disabled:opacity-60"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${sbChecking ? 'animate-spin' : ''}`} />
                  <span>{sbChecking ? 'Checking...' : 'Verify & Sync'}</span>
                </button>
              </div>
            </div>

            <div className="mt-6 overflow-x-auto">
              {leaderboard.length === 0 ? (
                <div className="py-8 text-center text-sm text-slate-400">
                  No runs recorded for this scope yet. Be the first on today’s board!
                </div>
              ) : (
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-white/10 text-xs text-slate-400 uppercase">
                      <th className="py-2.5 pr-4">#</th>
                      <th className="py-2.5 pr-4">Ranger</th>
                      <th className="py-2.5 pr-4">Mode</th>
                      <th className="py-2.5 pr-4">Companion</th>
                      <th className="py-2.5 pr-4">Biome</th>
                      <th className="py-2.5 pr-4">Time</th>
                      <th className="py-2.5 text-right">Score</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {leaderboard.map((rec, idx) => (
                      <tr key={rec.id} className="text-slate-200">
                        <td className="py-3 pr-4 font-bold text-amber-300 tabular-nums">
                          {idx + 1}
                        </td>
                        <td className="py-3 pr-4 font-semibold text-white">
                          {rec.playerName}
                          {rec.isDaily && (
                            <span className="ml-2 rounded bg-sky-500/20 px-1.5 py-0.5 text-[10px] text-sky-300">
                              Daily
                            </span>
                          )}
                        </td>
                        <td className="py-3 pr-4 text-xs text-emerald-300">
                          {MODE_LABELS[rec.mode]}
                        </td>
                        <td className="py-3 pr-4 text-xs">{ANIMALS[rec.animalId]?.name}</td>
                        <td className="py-3 pr-4 text-xs text-slate-300">
                          {BIOMES[rec.biomeId]?.name}
                        </td>
                        <td className="py-3 pr-4 text-xs tabular-nums text-slate-400">
                          {formatDuration(rec.elapsedSec)}
                        </td>
                        <td className="py-3 text-right font-bold text-amber-300 tabular-nums">
                          {rec.score}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </section>

        {/* AEO & GEO Knowledge Encyclopedia Section */}
        <section id="wild-facts" className="mx-auto max-w-6xl px-5 py-10">
          <div className="rounded-3xl border border-emerald-400/20 bg-slate-900/90 p-6 sm:p-8">
            <h2 className="text-xl font-bold text-white sm:text-2xl">
              Pakistan Wildlife &amp; Conservation Facts (At a Glance)
            </h2>
            <p className="mt-1.5 text-sm text-slate-300">
              Verified geographic habitats, species rarity tiers, and playable toolkit specs for players, educators, and wildlife enthusiasts worldwide.
            </p>
            <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-2xl border border-white/10 bg-slate-950/75 p-4">
                <div className="text-xs font-bold text-emerald-300 uppercase">5 Protected Regions</div>
                <p className="mt-1.5 text-xs leading-relaxed text-slate-300">
                  Northern Mountains (Karakoram &amp; Hunza), Deosai National Park (Skardu), Ziarat Juniper Forest (Balochistan), Indus River Dolphin Reserve (Sukkur), and Thar Desert Sanctuary (Sindh).
                </p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-slate-950/75 p-4">
                <div className="text-xs font-bold text-amber-300 uppercase">Photo Safari Scoring</div>
                <p className="mt-1.5 text-xs leading-relaxed text-slate-300">
                  Species Rarity (Common 100 · Rare 220 · Legendary 400) × Quality Grade (S 2.0× · A 1.5× · B 1.1× · C 0.7×) + 1.5× Action Bonus &amp; 2× Species of the Day.
                </p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-slate-950/75 p-4">
                <div className="text-xs font-bold text-sky-300 uppercase">3-Slot Ranger Toolkit</div>
                <p className="mt-1.5 text-xs leading-relaxed text-slate-300">
                  [1] 4.5× Binoculars to scout poachers &amp; snares (+65 pts), [2] Field Camera for wildlife evidence logs (+Conservation %), and [3] Tranquilizer Dart Rifle.
                </p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-slate-950/75 p-4">
                <div className="text-xs font-bold text-teal-300 uppercase">Free Cloud Accounts</div>
                <p className="mt-1.5 text-xs leading-relaxed text-slate-300">
                  100% free browser WebGL play (no downloads required), English &amp; Urdu toggle, offline PWA install, Supabase Auth &amp; Leaderboards, and Google Sheets feedback sync.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* FAQ Section */}
        <section id="faq" className="mx-auto max-w-4xl px-5 py-12">
          <div className="mb-6 text-center">
            <h2 className="text-2xl font-bold text-white sm:text-3xl">
              Frequently Asked Questions
            </h2>
          </div>
          <div className="space-y-3">
            {LANDING_FAQS.map((item, idx) => {
              const isOpen = openFaq === idx;
              return (
                <div
                  key={item.q}
                  className="rounded-2xl border border-white/10 bg-slate-900/95"
                >
                  <button
                    type="button"
                    onClick={() => setOpenFaq(isOpen ? null : idx)}
                    className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left"
                  >
                    <span className="text-sm font-semibold text-white sm:text-base">{item.q}</span>
                    <ChevronDown
                      className={`h-4 w-4 shrink-0 text-emerald-300 transition-transform ${
                        isOpen ? 'rotate-180' : ''
                      }`}
                    />
                  </button>
                  {isOpen && (
                    <div className="border-t border-white/5 px-5 py-3.5 text-sm leading-relaxed text-slate-300">
                      {item.a}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        {/* Footer */}
        <footer className="border-t border-white/10 bg-slate-950/90 px-5 py-10">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 text-xs text-slate-400">
            <div className="flex items-center gap-2">
              <Compass className="h-4 w-4 text-emerald-400" />
              <span>Wild Pakistan – The Last Wilderness · Wildlife Conservation Experience</span>
            </div>
            <div className="flex flex-wrap items-center gap-4">
              <button
                type="button"
                onClick={() => setShowFeedbackModal(true)}
                className="inline-flex items-center gap-1 text-sky-300 hover:text-sky-200"
              >
                <MessageSquarePlus className="h-3.5 w-3.5" />
                <span>Send Feedback</span>
              </button>
              <a href="./sitemap.xml" className="hover:text-slate-200">
                Sitemap
              </a>
              <a href="./llms.txt" className="hover:text-slate-200">
                llms.txt
              </a>
              <a
                href="./game/"
                onClick={(e) => {
                  e.preventDefault();
                  onNavigateGame();
                }}
                className="font-semibold text-emerald-300 hover:text-emerald-200"
              >
                Launch Game
              </a>
            </div>
          </div>
        </footer>
      </div>

      {showAlbum && (
        <PhotoAlbumModal
          photos={savedPhotos}
          lang={lang}
          onPhotosChange={setSavedPhotos}
          onClose={() => setShowAlbum(false)}
        />
      )}
      {showFeedbackModal && (
        <FeedbackModal
          playerName={account?.rangerName || 'Explorer'}
          account={account}
          mode="wild_life"
          animalId="markhor"
          biomeId="northern_mountains"
          round={1}
          score={0}
          victory={true}
          onClose={() => setShowFeedbackModal(false)}
        />
      )}
    </div>
  );
}
