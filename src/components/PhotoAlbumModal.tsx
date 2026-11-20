import { useState } from 'react';
import { Camera, Download, Share2, Sparkles, Trash2, X } from 'lucide-react';
import { SPECIES_RARITY_META } from '../data/animals';
import { getSpeciesOfTheDay } from '../data/dailyExpedition';
import { deleteSavedPhoto, shareOrDownloadPhoto } from '../data/photos';
import { Language, SavedPhotoEntry } from '../types/game';

interface PhotoAlbumModalProps {
  photos: SavedPhotoEntry[];
  lang?: Language;
  onPhotosChange: (next: SavedPhotoEntry[]) => void;
  onClose: () => void;
}

export function PhotoAlbumModal({
  photos,
  lang = 'en',
  onPhotosChange,
  onClose,
}: PhotoAlbumModalProps) {
  const [statusNote, setStatusNote] = useState('');
  const sotd = getSpeciesOfTheDay();

  const handleShare = async (photo: SavedPhotoEntry) => {
    const mode = await shareOrDownloadPhoto(photo);
    setStatusNote(
      mode === 'shared'
        ? lang === 'ur'
          ? 'تصویر شیئر کر دی گئی!'
          : 'Shared photo!'
        : lang === 'ur'
          ? 'تصویر ڈاؤن لوڈ ہو گئی!'
          : 'Downloaded snapshot!',
    );
    window.setTimeout(() => setStatusNote(''), 2500);
  };

  const handleDelete = (id: string) => {
    onPhotosChange(deleteSavedPhoto(id));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4">
      <div className="flex max-h-[86vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-sky-400/35 bg-slate-900 text-slate-100 shadow-2xl">
        <div className="flex items-center justify-between border-b border-white/10 px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-sky-500/20 text-sky-300">
              <Camera className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white">
                {lang === 'ur' ? 'جنگلی حیات فوٹو البم' : 'Wildlife Photo Collection'}
              </h2>
              <p className="text-xs text-slate-400">
                {lang === 'ur'
                  ? 'فوٹو سفاری کی محفوظ تصاویر شیئر یا ڈاؤن لوڈ کریں'
                  : 'Real 3D snapshots captured during Photo Safari expeditions'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-white/10 bg-white/5 p-2 text-slate-300 hover:bg-white/10 hover:text-white"
            aria-label="Close Photo Album"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="overflow-y-auto p-6">
          {/* Species of the Day highlight */}
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-400/30 bg-amber-950/30 px-4 py-3">
            <div>
              <div className="flex items-center gap-1.5 text-xs font-bold text-amber-300">
                <Sparkles className="h-3.5 w-3.5" />
                <span>
                  {lang === 'ur' ? 'آج کی خاص نسل' : 'Species of the Day'} ({sotd.dateKey})
                </span>
              </div>
              <div className="mt-0.5 text-sm font-bold text-white">
                {lang === 'ur' ? sotd.species.nameUr : sotd.species.name}{' '}
                <span className="text-xs font-normal italic text-slate-300">
                  ({sotd.species.scientificName})
                </span>
              </div>
              <div className="text-xs text-slate-300">
                {sotd.biome.name} — {sotd.species.fact}
              </div>
            </div>
            {statusNote && (
              <span className="rounded-lg bg-emerald-500/20 px-3 py-1 text-xs font-semibold text-emerald-200">
                {statusNote}
              </span>
            )}
          </div>

          {photos.length === 0 ? (
            <div className="rounded-2xl border border-white/10 bg-slate-950/60 py-12 text-center">
              <Camera className="mx-auto h-8 w-8 text-slate-500" />
              <p className="mt-2 text-sm font-medium text-slate-300">
                {lang === 'ur'
                  ? 'ابھی کوئی تصویر محفوظ نہیں ہے۔ فوٹو سفاری کھیلیں!'
                  : 'No photos saved yet. Play Photo Safari and frame wildlife steady to save snapshots!'}
              </p>
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              {photos.map((photo) => {
                const rarityInfo = photo.rarity ? SPECIES_RARITY_META[photo.rarity] : null;
                return (
                <div
                  key={photo.id}
                  className="overflow-hidden rounded-2xl border border-white/10 bg-slate-950/80"
                >
                  <div className="relative">
                    <img
                      src={photo.dataUrl}
                      alt={`${photo.speciesName} in ${photo.biomeName}`}
                      className="h-44 w-full object-cover"
                    />
                    {(rarityInfo || photo.qualityGrade || photo.photoScore) && (
                      <div className="absolute left-2.5 right-2.5 top-2.5 flex flex-wrap items-center justify-between gap-1">
                        <div className="flex items-center gap-1">
                          {rarityInfo && (
                            <span
                              className={`rounded border px-1.5 py-0.5 text-[10px] font-bold uppercase ${rarityInfo.badgeCls}`}
                            >
                              {rarityInfo.label}
                            </span>
                          )}
                          {photo.qualityGrade && (
                            <span
                              className={`rounded px-1.5 py-0.5 text-[10px] font-extrabold ${
                                photo.qualityGrade === 'S'
                                  ? 'bg-amber-400 text-slate-950'
                                  : photo.qualityGrade === 'A'
                                    ? 'bg-emerald-400 text-slate-950'
                                    : 'bg-sky-400 text-slate-950'
                              }`}
                            >
                              {photo.qualityGrade}-RANK
                            </span>
                          )}
                        </div>
                        {photo.photoScore != null && photo.photoScore > 0 && (
                          <span className="rounded bg-slate-950/90 px-2 py-0.5 text-[10px] font-bold text-amber-300 tabular-nums">
                            +{photo.photoScore} pts
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="p-3.5">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="text-sm font-bold text-white">{photo.speciesName}</div>
                        <div className="text-[11px] italic text-slate-400">
                          {photo.scientificName} · {photo.biomeName}
                        </div>
                        <div className="mt-0.5 text-[10px] text-emerald-300">
                          {lang === 'ur' ? 'فوٹوگرافر:' : 'By'} {photo.rangerName}
                          {photo.actionTag ? ` · ${photo.actionTag}` : ''}
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => handleShare(photo)}
                          title="Share / Download"
                          className="rounded-lg bg-sky-500/20 p-2 text-sky-200 hover:bg-sky-500/35"
                        >
                          {typeof navigator !== 'undefined' && 'share' in navigator ? (
                            <Share2 className="h-3.5 w-3.5" />
                          ) : (
                            <Download className="h-3.5 w-3.5" />
                          )}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDelete(photo.id)}
                          title="Delete Photo"
                          className="rounded-lg bg-rose-500/15 p-2 text-rose-300 hover:bg-rose-500/30"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
