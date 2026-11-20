import { useState } from 'react';
import { Box, Check, Trash2, Upload, X } from 'lucide-react';
import { ALL_CHARACTERS } from '../data/animals';
import { customGlbStore } from '../game/models';
import { AnimalId } from '../types/game';

interface CustomGlbModalProps {
  onClose: () => void;
  onModelUpdated: () => void;
}

export function CustomGlbModal({ onClose, onModelUpdated }: CustomGlbModalProps) {
  const [loaded, setLoaded] = useState<AnimalId[]>(() => customGlbStore.getLoadedNames());
  const [error, setError] = useState('');

  const handleFile = async (id: AnimalId, file?: File) => {
    if (!file) return;
    setError('');
    try {
      await customGlbStore.loadFromFile(id, file);
      setLoaded(customGlbStore.getLoadedNames());
      onModelUpdated();
    } catch {
      setError(`Could not parse ${file.name}. Ensure it is a valid binary .glb model.`);
    }
  };

  const handleClear = (id: AnimalId) => {
    customGlbStore.clearModel(id);
    setLoaded(customGlbStore.getLoadedNames());
    onModelUpdated();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4">
      <div className="flex max-h-[85vh] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-emerald-400/30 bg-slate-900 text-slate-100 shadow-2xl">
        <div className="flex items-center justify-between border-b border-white/10 px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/20 text-emerald-300">
              <Box className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white">Custom .GLB Model Loader</h2>
              <p className="text-xs text-slate-400">
                Optional: replace procedural low-poly rigs with your own .glb models
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-white/10 bg-white/5 p-2 text-slate-300 hover:bg-white/10"
            aria-label="Close Custom Model Loader"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-3 overflow-y-auto p-6">
          {error && (
            <div className="rounded-xl border border-rose-500/40 bg-rose-950/50 px-3 py-2 text-xs text-rose-200">
              {error}
            </div>
          )}
          {ALL_CHARACTERS.map((char) => {
            const isLoaded = loaded.includes(char.id);
            return (
              <div
                key={char.id}
                className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-slate-950/60 px-4 py-3"
              >
                <div>
                  <div className="text-sm font-semibold text-white">{char.name}</div>
                  <div className="text-xs text-slate-400">
                    {isLoaded ? 'Custom .glb active' : 'Procedural low-poly mesh'}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {isLoaded && (
                    <button
                      type="button"
                      onClick={() => handleClear(char.id)}
                      className="inline-flex items-center gap-1 rounded-lg border border-rose-400/30 bg-rose-500/15 px-2.5 py-1.5 text-xs text-rose-200 hover:bg-rose-500/25"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Reset
                    </button>
                  )}
                  <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-emerald-400/40 bg-emerald-500/20 px-3 py-1.5 text-xs font-medium text-emerald-200 hover:bg-emerald-500/30">
                    {isLoaded ? <Check className="h-3.5 w-3.5" /> : <Upload className="h-3.5 w-3.5" />}
                    {isLoaded ? 'Replace .glb' : 'Load .glb'}
                    <input
                      type="file"
                      accept=".glb,.gltf"
                      className="hidden"
                      onChange={(e) => handleFile(char.id, e.target.files?.[0])}
                    />
                  </label>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
