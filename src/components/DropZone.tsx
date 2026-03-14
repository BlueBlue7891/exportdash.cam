'use client';

import { useCallback, useState, useEffect, useRef } from 'react';

interface DropZoneProps {
  onFilesAdded: (files: File[]) => void;
  hasVideos: boolean;
  onScanProgress?: (current: number, total: number) => void;
}

// Check if running in Tauri
const isTauri = () => typeof window !== 'undefined' && 
  (('__TAURI__' in window) || (window as any).__TAURI_INTERNALS__);

export function DropZone({ onFilesAdded, hasVideos, onScanProgress }: DropZoneProps) {
  const [isDragging, setIsDragging] = useState(false);
  const isTauriSetupRef = useRef(false);
  const [hasTauri, setHasTauri] = useState(false);
  
  useEffect(() => {
    setHasTauri(isTauri());
  }, []);

  // Tauri drag-drop setup
  useEffect(() => {
    if (isTauriSetupRef.current) return;
    isTauriSetupRef.current = true;

    const setupTauri = async () => {
      const hasTauri = typeof window !== 'undefined' && 
        (('__TAURI__' in window) || (window as any).__TAURI_INTERNALS__);
      
      console.log('[DropZone] Tauri detected:', hasTauri);
      if (!hasTauri) return;

      try {
        const { getCurrentWebview } = await import('@tauri-apps/api/webview');
        const { readDir } = await import('@tauri-apps/plugin-fs');
        const { convertFileSrc } = await import('@tauri-apps/api/core');
        const webview = getCurrentWebview();

        const unlisten = await webview.onDragDropEvent(async (event) => {
          const { type } = event.payload;

          if (type === 'enter' || type === 'over') {
            setIsDragging(true);
          } else if (type === 'leave') {
            setIsDragging(false);
          } else if (type === 'drop') {
            setIsDragging(false);
            const { paths } = event.payload as { paths: string[] };
            if (!paths || paths.length === 0) return;

            console.log('[DropZone] Dropped paths:', paths.length);

            // PHASE 1: Scan for video files recursively (fast, no reading)
            const fileEntries: { path: string; name: string; type: string }[] = [];
            
            // Recursive directory scanner
            const scanDirectory = async (dirPath: string) => {
              try {
                const entries = await readDir(dirPath);
                for (const entry of entries) {
                  const fullPath = dirPath.replace(/\\/g, '/') + '/' + entry.name;
                  const lower = entry.name.toLowerCase();
                  
                  if (entry.isDirectory) {
                    // Recursively scan subdirectories
                    await scanDirectory(fullPath);
                  } else if (lower.endsWith('.mp4') || lower === 'event.json') {
                    fileEntries.push({
                      path: fullPath,
                      name: entry.name,
                      type: lower.endsWith('.mp4') ? 'video/mp4' : 'application/json'
                    });
                  }
                }
              } catch (e) {
                // Not a directory or permission error - ignore
              }
            };
            
            for (const path of paths) {
              const name = path.split(/[/\\]/).pop() || '';
              const lower = name.toLowerCase();
              
              if (lower.endsWith('.mp4') || lower === 'event.json') {
                // Direct file drop
                fileEntries.push({ path, name, type: lower.endsWith('.mp4') ? 'video/mp4' : 'application/json' });
              } else {
                // Scan directory recursively
                await scanDirectory(path);
              }
            }

            console.log('[DropZone] Video files found:', fileEntries.length);
            if (fileEntries.length === 0) return;

            // Show loading UI
            onScanProgress?.(0, fileEntries.length);

            // PHASE 2: Create File objects with Tauri URLs (FAST!)
            const files: File[] = [];
            
            for (const { path, name, type } of fileEntries) {
              try {
                // Use convertFileSrc to get a URL that can be loaded by webview
                // This is MUCH faster than reading the entire file into memory
                const assetUrl = convertFileSrc(path);
                
                // Create a File object with minimal content (we don't need the data)
                // The actual video will be loaded from assetUrl
                const file = new File([], name, { type });
                
                // Store the Tauri URL as a custom property
                (file as any).tauriUrl = assetUrl;
                (file as any).tauriPath = path;
                
                files.push(file);
              } catch (e) {
                console.error('Convert error:', path, e);
              }
              
              // Update progress every 10 files
              if (files.length % 10 === 0) {
                onScanProgress?.(files.length, fileEntries.length);
              }
            }

            onScanProgress?.(fileEntries.length, fileEntries.length);
            console.log('[DropZone] Created file objects:', files.length);
            
            if (files.length > 0) {
              onFilesAdded(files);
            }
          }
        });

        console.log('[DropZone] Tauri listener registered');
        return () => unlisten();
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
  
  // Tauri: Open multiple folders using native dialog
  const handleOpenFoldersTauri = useCallback(async () => {
    if (!hasTauri) return;
    
    try {
      // Use Tauri's dialog API if available
      const { open } = await import('@tauri-apps/plugin-dialog');
      const { readDir, readFile } = await import('@tauri-apps/plugin-fs');
      const { convertFileSrc } = await import('@tauri-apps/api/core');
      
      // Open multiple directories
      const selected = await open({
        directory: true,
        multiple: true,
        title: 'Select TeslaCam Folders'
      });
      
      if (!selected || (Array.isArray(selected) && selected.length === 0)) return;
      
      const paths = Array.isArray(selected) ? selected : [selected];
      
      // Scan for video files
      onScanProgress?.(0, paths.length);
      const fileEntries: { path: string; name: string; type: string }[] = [];
      
      const scanDirectory = async (dirPath: string) => {
        try {
          const entries = await readDir(dirPath);
          for (const entry of entries) {
            const fullPath = dirPath.replace(/\\/g, '/') + '/' + entry.name;
            const lower = entry.name.toLowerCase();
            
            if (entry.isDirectory) {
              await scanDirectory(fullPath);
            } else if (lower.endsWith('.mp4') || lower === 'event.json') {
              fileEntries.push({
                path: fullPath,
                name: entry.name,
                type: lower.endsWith('.mp4') ? 'video/mp4' : 'application/json'
              });
            }
          }
        } catch (e) {
          // Ignore errors
        }
      };
      
      for (let i = 0; i < paths.length; i++) {
        await scanDirectory(paths[i]);
        onScanProgress?.(i + 1, paths.length);
      }
      
      if (fileEntries.length === 0) return;
      
      // Create File objects with Tauri URLs
      // For event.json, we need to read the actual content
      // For video files, we just need the path (content will be read via Tauri URL)
      const files: any[] = [];
      for (const { path, name, type } of fileEntries) {
        try {
          const assetUrl = convertFileSrc(path);
          
          // Calculate relative path for folder structure detection
          const pathParts = path.replace(/\\/g, '/').split('/');
          const teslaCamIndex = pathParts.findIndex(p => p.toLowerCase().includes('teslacam'));
          const relativePath = teslaCamIndex >= 0 
            ? pathParts.slice(teslaCamIndex).join('/')
            : pathParts.slice(-3).join('/');
          
          // For event.json, read actual content so text() method works
          let fileContent: BlobPart[] = [];
          if (name === 'event.json') {
            const content = await readFile(path);
            fileContent = [new Uint8Array(content)];
          }
          
          // Create File with content for event.json, empty for video files
          const file = new File(fileContent, name, { type });
          
          // Create a wrapper that behaves like a File but with extra properties
          const fileWrapper = {
            ...file,
            name: file.name,
            size: file.size,
            type: file.type,
            lastModified: file.lastModified,
            webkitRelativePath: relativePath,
            tauriUrl: assetUrl,
            tauriPath: path,
            // Bind File methods to the original file
            slice: file.slice.bind(file),
            stream: file.stream.bind(file),
            text: file.text.bind(file),
            arrayBuffer: file.arrayBuffer.bind(file),
            [Symbol.toStringTag]: 'File'
          };
          
          files.push(fileWrapper);
        } catch (e) {
          console.error('Convert error:', path, e);
        }
      }
      
      if (files.length > 0) {
        onFilesAdded(files);
      }
    } catch (error) {
      console.error('Tauri folder select error:', error);
      // Fallback: show alert to use drag-drop instead
      alert('Please drag and drop folders to import multiple folders, or use Open Folder for single folder.');
    }
  }, [hasTauri, onFilesAdded, onScanProgress]);

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
        <div className="flex flex-col items-center gap-4 relative z-10">
          <div className="w-16 h-16 rounded-full bg-gray-800 flex items-center justify-center">
            <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
            </svg>
          </div>
          <div className="text-center">
            <p className="text-xl font-medium text-gray-200">Import TeslaCam Recordings</p>
            <p className="text-sm text-gray-500 mt-2 leading-relaxed">
              <span className="text-gray-400">Quick Load</span> — drop clips or a folder to import instantly<br />
              <span className="text-gray-400">Select Clips</span> — click <span className="text-gray-300 font-medium">Browse Files</span> to pick multiple clips<br />
              <span className="text-gray-400">Browse by Date</span> — click <span className="text-gray-300 font-medium">Open Folder</span> to explore via <span className="text-gray-300 font-medium">calendar</span>
            </p>
          </div>
          <div className="flex items-center gap-3 mt-4">
            <label className="px-5 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg cursor-pointer transition-colors border border-gray-600">
              <span>Browse Files</span>
              <input type="file" accept="video/mp4,application/json" multiple onChange={handleFileInput} className="hidden" />
            </label>
            {hasTauri ? (
              <button 
                onClick={handleOpenFoldersTauri}
                className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg cursor-pointer transition-colors"
              >
                Open Folder(s)
              </button>
            ) : (
              <label className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg cursor-pointer transition-colors">
                <span>Open Folder</span>
                <input type="file" {...{ webkitdirectory: 'true', directory: 'true' } as any} onChange={handleFileInput} className="hidden" />
              </label>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
