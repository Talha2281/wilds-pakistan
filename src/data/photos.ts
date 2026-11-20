import { SavedPhotoEntry } from '../types/game';

const PHOTOS_KEY = 'wild_pakistan_saved_photos_v1';

export function loadSavedPhotos(): SavedPhotoEntry[] {
  try {
    const raw = localStorage.getItem(PHOTOS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as SavedPhotoEntry[]) : [];
  } catch {
    return [];
  }
}

export function saveCapturedPhoto(entry: SavedPhotoEntry): SavedPhotoEntry[] {
  const existing = loadSavedPhotos();
  const next = [entry, ...existing].slice(0, 14);
  try {
    localStorage.setItem(PHOTOS_KEY, JSON.stringify(next));
  } catch {
    // If quota is tight, keep fewer photos
    try {
      localStorage.setItem(PHOTOS_KEY, JSON.stringify(next.slice(0, 6)));
    } catch {
      // ignore
    }
  }
  return next;
}

export function deleteSavedPhoto(id: string): SavedPhotoEntry[] {
  const next = loadSavedPhotos().filter((p) => p.id !== id);
  try {
    localStorage.setItem(PHOTOS_KEY, JSON.stringify(next));
  } catch {
    // ignore
  }
  return next;
}

export async function shareOrDownloadPhoto(photo: SavedPhotoEntry): Promise<'shared' | 'downloaded'> {
  try {
    if (navigator.share) {
      const res = await fetch(photo.dataUrl);
      const blob = await res.blob();
      const file = new File([blob], `${photo.speciesId}-${photo.biomeId}.jpg`, {
        type: 'image/jpeg',
      });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({
          title: `${photo.speciesName} — Wild Pakistan`,
          text: `Photographed a wild ${photo.speciesName} (${photo.scientificName}) in ${photo.biomeName} on Wild Pakistan!`,
          files: [file],
        });
        return 'shared';
      }
    }
  } catch {
    // Fall through to clean download
  }

  const a = document.createElement('a');
  a.href = photo.dataUrl;
  a.download = `wild-pakistan-${photo.speciesId}-${Date.now()}.jpg`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  return 'downloaded';
}
