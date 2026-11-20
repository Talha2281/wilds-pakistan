import { useEffect, useState } from 'react';
import { WifiOff } from 'lucide-react';
import { Language } from '../types/game';

export function OfflineIndicator({ lang = 'en' }: { lang?: Language }) {
  const [online, setOnline] = useState<boolean>(() =>
    typeof navigator !== 'undefined' ? navigator.onLine : true,
  );

  useEffect(() => {
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  if (online) return null;

  return (
    <div className="fixed bottom-4 left-4 z-50 flex items-center gap-2 rounded-xl border border-amber-400/50 bg-slate-900 px-3.5 py-2 text-xs font-semibold text-amber-200 shadow-xl">
      <WifiOff className="h-3.5 w-3.5 text-amber-300" />
      <span>
        {lang === 'ur'
          ? 'آف لائن موڈ: تمام 3D علاقے دستیاب ہیں'
          : 'Offline mode: 3D wilderness cached locally'}
      </span>
    </div>
  );
}
