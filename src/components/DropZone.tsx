'use client';

import { useCallback, useState, useEffect, useRef } from 'react';

interface DropZoneProps {
  onFilesAdded: (files: File[]) => void;
  hasVideos: boolean;
  onScanProgress?: (current: number, total: number) => void;
}

export function DropZone({ onFilesAdded, hasVideos, onScanProgress }: DropZoneProps) {
  const [isDragging, setIsDragging] = useState(false);
  const isTauriSetupRef = useRef(false);

  // Tauri drag-drop setup
  useEffect(() => {
    if (isTauriSetupRef.current) return;
    isTauriSetupRef.current = true;

    const setupTauri = async () => {
      // Detect Tauri environment
      const hasTauri = typeof window !== 'undefined' && 
        (('__TAURI__' in window) || 
         (window as any).__TAURI_INTERNALS__ ||
         (window as any).isTauri);
      
      console.log('[DropZone] Tauri detected:', hasTauri);
      
      if (!hasTauri) return;

      try {
        const { getCurrentWebview } = await import('@tauri-apps/api/webview');
        const { readFile, readDir } = await import('@tauri-apps/plugin-fs');
        
        const webview = getCurrentWebview();
        console.log('[DropZone] Webview obtained');

        const unlisten = await webview.onDragDropEvent(async (event) => {
          console.log('[DropZone] Drag event:', event.payload.type);
          
          const { type, paths } = event.payload;

          if (type === 'enter' || type === 'over') {
            setIsDragging(true);
          } else if (type === 'leave') {
            setIsDragging(false);
          } else if (type === 'drop') {
            setIsDragging(false);

            if (!paths || paths.length === 0) {
              console.log('[DropZone] No paths');
              return;
            }

            console.log('[DropZone] Dropped paths:', paths.length);

            // Quick scan for video files
            const filePaths: string[] = [];
            
            for (const path of paths) {
              const name = path.split(/[/\\]/).pop() || '';
              const lower = name.toLowerCase();
              
              if (lower.endsWith('.mp4') || lower === 'event.json') {
                filePaths.push(path);
              } else if (!lower.includes('.')) {
                // Try as directory
                try {
                  const entries = await readDir(path);
                  for (const entry of entries) {
                    const el = entry.name.toLowerCase();
                    if (el.endsWith('.mp4') || el === 'event.json') {
                      filePaths.push(path + '/' + entry.name);
                    }
                  }
                } catch {}
              }
            }

            console.log('[DropZone] Video files:', filePaths.length);
            if (filePaths.length === 0) return;

            onScanProgress?.(0, filePaths.length);

            // Read all files
            const files: File[] = [];
            for (let i = 0; i < filePaths.length; i++) {
              try {
                const path = filePaths[i];
                const name = path.split(/[/\\]/).pop() || '';
                const contents = await readFile(path);
                const blob = new Blob([contents], { 
                  type: name.endsWith('.mp4') ? 'video/mp4' : 'application/json' 
                });
                files.push(new File([blob], name));
              } catch (e) {
                console.error('Read error:', e);
              }
              
              onScanProgress?.(i + 1, filePaths.length);
            }

            console.log('[DropZone] Loaded files:', files.length);
            if (files.length > 0) {
              onFilesAdded(files);
            }
          }
        });

        console.log('[DropZone] Listener registered');
        
        return () => {
          unlisten();
        };
      } catch (e) {
        console.error('[DropZone] Setup error:', e);
      }
    };

    setupTauri();
  }, [onFilesAdded, onScanProgress]);

  // Browser handlers
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);

      const items = e.dataTransfer.items;
      const files: File[] = [];

      const processEntry = async (entry: FileSystemEntry): Promise<void> => {
        if (entry.isFile) {
          const fileEntry = entry as FileSystemFileEntry;
          const file = await new Promise<File>((resolve) => {
            fileEntry.file(resolve);
          });
          if (file.name.toLowerCase().match(/\.(mp4|json)$/)) {
            files.push(file);
          }
        } else if (entry.isDirectory) {
          const dirEntry = entry as FileSystemDirectoryEntry;
          const reader = dirEntry.createReader();
          const entries: FileSystemEntry[] = [];
          let batch: FileSystemEntry[];
          do {
            batch = await new Promise((resolve) => reader.readEntries(resolve));
            entries.push(...batch);
          } while (batch.length > 0);
          await Promise.all(entries.map(processEntry));
        }
      };

      const entries: FileSystemEntry[] = [];
      for (let i = 0; i < items.length; i++) {
        const entry = items[i].webkitGetAsEntry?.();
        if (entry) entries.push(entry);
      }

      if (entries.length > 0) {
        await Promise.all(entries.map(processEntry));
      } else {
        files.push(...Array.from(e.dataTransfer.files));
      }

      if (files.length > 0) {
        onFilesAdded(files);
      }
    },
    [onFilesAdded]
  );

  const handleFileInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files || []);
      if (files.length > 0) onFilesAdded(files);
    },
    [onFilesAdded]
  );

  const dropZoneClasses = hasVideos
    ? `border-2 border-dashed rounded-lg p-4 text-center transition-colors ${
        isDragging ? 'border-blue-500 bg-blue-500/10' : 'border-gray-600 hover:border-gray-500'
      }`
    : `border-2 border-dashed rounded-xl p-12 text-center transition-all relative overflow-hidden ${
        isDragging ? 'border-blue-500 bg-blue-500/10 scale-[1.02]' : 'border-gray-600 hover:border-gray-500'
      }`;

  return (
    <div
      className={dropZoneClasses}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {hasVideos ? (
        <label className="cursor-pointer text-gray-400 hover:text-gray-300">
          <span className="text-sm">Drop more videos or click to add</span>
          <input
            type="file"
            accept="video/mp4,application/json"
            multiple
            onChange={handleFileInput}
            className="hidden"
          />
        </label>
      ) : (
        <>
          <div className="flex flex-col items-center gap-4 relative z-10">
            <div className="w-16 h-16 rounded-full bg-gray-800 flex items-center justify-center">
              <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
              </svg>
            </div>
            <div className="text-center">
              <p className="text-xl font-medium text-gray-200">Drop your TeslaCam clips here</p>
              <p className="text-sm text-gray-500 mt-2">Drag & drop a folder containing video files</p>
            </div>
            <div className="flex items-center gap-3 mt-4">
              <label className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg cursor-pointer transition-colors">
                <span>Browse Files</span>
                <input type="file" accept="video/mp4,application/json" multiple onChange={handleFileInput} className="hidden" />
              </label>
              <label className="px-6 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg cursor-pointer transition-colors border border-gray-600">
                <span>Import Folder</span>
                <input type="file" webkitdirectory="" directory="" onChange={handleFileInput} className="hidden" />
              </label>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
