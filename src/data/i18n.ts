import { useEffect, useState } from 'react';
import { Language } from '../types/game';

const LANG_KEY = 'wild_pakistan_lang_v1';

export function getSavedLanguage(): Language {
  try {
    const val = localStorage.getItem(LANG_KEY);
    return val === 'ur' ? 'ur' : 'en';
  } catch {
    return 'en';
  }
}

export function setSavedLanguage(lang: Language): void {
  try {
    localStorage.setItem(LANG_KEY, lang);
    window.dispatchEvent(new CustomEvent('wp-lang-change', { detail: lang }));
  } catch {
    // ignore
  }
}

export function useLanguage(): [Language, (l: Language) => void] {
  const [lang, setLang] = useState<Language>(() => getSavedLanguage());

  useEffect(() => {
    const handler = (e: Event) => {
      const next = (e as CustomEvent<Language>).detail;
      if (next === 'en' || next === 'ur') setLang(next);
    };
    window.addEventListener('wp-lang-change', handler);
    return () => window.removeEventListener('wp-lang-change', handler);
  }, []);

  const update = (next: Language) => {
    setLang(next);
    setSavedLanguage(next);
  };

  return [lang, update];
}

export const COPY = {
  en: {
    brandTitle: 'Wild Pakistan',
    brandSubtitle: 'The Last Wilderness',
    playFree: 'Play Free',
    enterWilderness: 'Enter the Wilderness',
    hallOfRangers: 'Hall of Rangers',
    dailyExpedition: 'Daily Expedition',
    playDaily: 'Play Daily Expedition',
    speciesOfDay: 'Species of the Day',
    conservationMeter: 'Conservation Meter',
    xpProgress: 'Ranger XP & Unlocks',
    photoAlbum: 'Photo Album',
    coopMultiplayer: 'Co-op Squad',
    setupTitle: 'Wild Pakistan – Expedition Setup',
    setupSubtitle: 'Choose your mode, wildlife companion, skins, biome & co-op room',
    rangerNameLabel: '1. Ranger / Explorer Name',
    rangerNamePlaceholder: 'Enter your name for the Hall of Rangers...',
    modeLabel: '2. Conservation Mode',
    animalLabel: '3. Wildlife / Ranger, Skins & Unlocks',
    biomeLabel: '4. Habitat Biome, Season & Weather',
    startExpedition: 'Start Expedition',
    beginRun: 'Begin Run',
    back: 'Back',
    paused: 'Expedition Paused',
    resume: 'Resume',
    restartSeed: 'Restart New Map',
    roundComplete: 'Round Complete!',
    keepExploring: 'Keep exploring this biome',
    wildernessClaimed: 'Wilderness Claimed You',
    tryAgain: 'Try Again',
    habitatPicker: 'Habitat Picker',
    weeklyChallenge: 'Weekly Challenge',
    dailyLeaderboard: 'Daily Board',
    weeklyLeaderboard: 'Weekly Board',
    allTimeLeaderboard: 'All-Time Board',
    tutorialTitle: 'First-Minute Field Briefing',
    skipTutorial: 'Skip',
    growthCub: 'Cub',
    growthJuvenile: 'Juvenile',
    growthAdult: 'Adult',
    modes: {
      wild_life: 'Wild Life',
      ranger_patrol: 'Ranger Patrol',
      photo_safari: 'Photo Safari',
    },
    seasons: {
      spring: 'Spring',
      summer: 'Summer',
      autumn: 'Autumn',
      winter: 'Winter',
    },
  },
  ur: {
    brandTitle: 'وائلڈ پاکستان',
    brandSubtitle: 'آخری جنگلی حیات',
    playFree: 'مفت کھیلیں',
    enterWilderness: 'جنگل میں داخل ہوں',
    hallOfRangers: 'ہال آف رینجرز',
    dailyExpedition: 'آج کا مشترکہ مشن',
    playDaily: 'آج کا مشن کھیلیں',
    speciesOfDay: 'آج کی خاص نسل',
    conservationMeter: 'تحفظِ حیات میٹر',
    xpProgress: 'تجربہ (XP) اور انعامات',
    photoAlbum: 'فوٹو البم',
    coopMultiplayer: 'مشترکہ کو-آپ موڈ',
    setupTitle: 'وائلڈ پاکستان – مہم کی تیاری',
    setupSubtitle: 'موڈ، جانور، کھال، علاقہ، موسم اور کو-آپ ٹیم منتخب کریں',
    rangerNameLabel: '1. رینجر / کھلاڑی کا نام',
    rangerNamePlaceholder: 'لیڈربورڈ کے لیے اپنا نام لکھیں...',
    modeLabel: '2. گیم موڈ منتخب کریں',
    animalLabel: '3. جانور / رینجر اور کھالیں',
    biomeLabel: '4. علاقہ، موسم اور آب و ہوا',
    startExpedition: 'مہم شروع کریں',
    beginRun: 'آغاز کریں',
    back: 'واپس',
    paused: 'کھیل روکا گیا',
    resume: 'جاری رکھیں',
    restartSeed: 'نیا نقشہ شروع کریں',
    roundComplete: 'مرحلہ مکمل!',
    keepExploring: 'اس علاقے کی سیر جاری رکھیں',
    wildernessClaimed: 'جنگل نے آپ کو ہرا دیا',
    tryAgain: 'دوبارہ کوشش کریں',
    habitatPicker: 'مقام منتخب کریں',
    weeklyChallenge: 'ہفتہ وار چیلنج',
    dailyLeaderboard: 'روزانہ بورڈ',
    weeklyLeaderboard: 'ہفتہ وار بورڈ',
    allTimeLeaderboard: 'مجموعی بورڈ',
    tutorialTitle: 'پہلے منٹ کی تربیت',
    skipTutorial: 'چھوڑیں',
    growthCub: 'بچہ',
    growthJuvenile: 'نوجوان',
    growthAdult: 'بالغ',
    modes: {
      wild_life: 'جنگلی حیات',
      ranger_patrol: 'رینجر گشت',
      photo_safari: 'فوٹو سفاری',
    },
    seasons: {
      spring: 'بہار',
      summer: 'گرمی',
      autumn: 'خزاں',
      winter: 'سردی',
    },
  },
} as const;
