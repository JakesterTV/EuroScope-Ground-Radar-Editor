import { useState, useCallback } from 'react';
import { useStore } from '../store/useStore';

interface FileUploadProps {
  onClose: () => void;
}

export function FileUpload({ onClose }: FileUploadProps) {
  const loadFromText = useStore(s => s.loadFromText);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const processFile = useCallback(
    (file: File) => {
      if (!file.name.endsWith('.txt')) {
        setError('Please drop a .txt file (GRpluginMaps format).');
        return;
      }
      const reader = new FileReader();
      reader.onload = e => {
        const text = e.target?.result as string;
        loadFromText(text, file.name);
        onClose();
      };
      reader.onerror = () => setError('Failed to read file.');
      reader.readAsText(file, 'utf-8');
    },
    [loadFromText, onClose]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      const file = e.dataTransfer.files[0];
      if (file) processFile(file);
    },
    [processFile]
  );

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) processFile(file);
    },
    [processFile]
  );

  return (
    <div className="absolute inset-0 z-[1000] bg-black/70 flex items-center justify-center">
      <div className="bg-slate-800 rounded-xl border border-slate-600 p-8 w-96 shadow-2xl">
        <h2 className="text-lg font-semibold text-slate-200 mb-1">Open Map File</h2>
        <p className="text-xs text-slate-400 mb-5">
          Drop a GRpluginMaps .txt file or use the Load button in the toolbar.
        </p>

        {/* Drop zone */}
        <label
          className={`
            block border-2 border-dashed rounded-lg py-10 text-center cursor-pointer transition-colors
            ${dragging
              ? 'border-blue-400 bg-blue-900/20 text-blue-300'
              : 'border-slate-600 hover:border-slate-400 text-slate-500'}
          `}
          onDragOver={e => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
        >
          <input type="file" accept=".txt" className="hidden" onChange={handleChange} />
          <div className="text-3xl mb-2">📂</div>
          <div className="text-sm">Drag & drop your file here</div>
          <div className="text-xs mt-1 opacity-60">or click to browse</div>
        </label>

        {error && (
          <p className="mt-3 text-xs text-red-400 bg-red-950/50 rounded p-2">{error}</p>
        )}

        <button
          onClick={onClose}
          className="mt-4 w-full bg-slate-700 hover:bg-slate-600 text-slate-300 text-sm py-2 rounded transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
