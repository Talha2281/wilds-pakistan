import { useEffect, useState } from 'react';
import { Download, Share, Smartphone, X } from 'lucide-react';
import { Language } from '../types/game';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export function PWAInstallButton({ lang = 'en' }: { lang?: Language }) {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState(false);
  const [isIos, setIsIos] = useState(false);
  const [showIosGuide, setShowIosGuide] = useState(false);

  useEffect(() => {
    const standalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as unknown as { standalone?: boolean }).standalone === true;
    setIsInstalled(standalone);

    const ua = window.navigator.userAgent;
    const iosDevice = /iPad|iPhone|iPod/.test(ua) && !(window as unknown as { MSStream?: unknown }).MSStream;
    setIsIos(iosDevice);

    const onBeforeInstall = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setIsInstalled(true);
      setDeferredPrompt(null);
    };

    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  if (isInstalled) return null;
  if (!deferredPrompt && !isIos) return null;

  const handleInstallClick = async () => {
    if (deferredPrompt) {
      await deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === 'accepted') setDeferredPrompt(null);
      return;
    }
    if (isIos) {
      setShowIosGuide(true);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={handleInstallClick}
        className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-400/40 bg-emerald-500/15 px-3 py-2 text-xs font-semibold text-emerald-200 hover:bg-emerald-500/25"
      >
        <Download className="h-3.5 w-3.5" />
        <span>{lang === 'ur' ? 'ایپ انسٹال کریں' : 'Install App'}</span>
      </button>

      {showIosGuide && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4">
          <div className="w-full max-w-sm rounded-2xl border border-emerald-400/35 bg-slate-900 p-5 text-slate-100 shadow-2xl">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-bold text-white">
                <Smartphone className="h-4 w-4 text-emerald-300" />
                <span>{lang === 'ur' ? 'آئی فون پر انسٹال کریں' : 'Install on iOS Safari'}</span>
              </div>
              <button
                type="button"
                onClick={() => setShowIosGuide(false)}
                className="rounded-lg p-1 text-slate-400 hover:bg-white/10 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <ol className="mt-3 space-y-2 text-xs text-slate-300">
              <li className="flex items-center gap-2">
                <span className="rounded bg-white/10 px-1.5 py-0.5 font-bold text-emerald-300">1</span>
                <span>
                  {lang === 'ur' ? 'نیچے Share آئیکن دبائیں' : 'Tap the Safari Share button'}{' '}
                  <Share className="inline h-3.5 w-3.5 text-sky-300" />
                </span>
              </li>
              <li className="flex items-center gap-2">
                <span className="rounded bg-white/10 px-1.5 py-0.5 font-bold text-emerald-300">2</span>
                <span>
                  {lang === 'ur'
                    ? '"Add to Home Screen" منتخب کریں'
                    : 'Choose "Add to Home Screen"'}
                </span>
              </li>
            </ol>
          </div>
        </div>
      )}
    </>
  );
}
