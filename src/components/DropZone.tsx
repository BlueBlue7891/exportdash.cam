'use client';

import { useCallback, useState, useEffect, useRef } from 'react';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { readFile, readDir } from '@tauri-apps/plugin-fs';
import { resolve } from '@tauri-apps/api/path';

interface DropZoneProps {
  onFilesAdded: (files: File[]) => void;
  hasVideos: boolean;
}

export function DropZone({ onFilesAdded, hasVideos }: DropZoneProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [isLoadingFiles, setIsLoadingFiles] = useState(false);
  const [loadingFileCount, setLoadingFileCount] = useState(0);
  const [loadingFileIndex, setLoadingFileIndex] = useState(0);

  // Check if running in Tauri (需要在 useEffect 中检查，避免 SSR 问题)

  // 防止重复设置拖放监听器
  const dragDropSetupRef = useRef(false);
  // 防止重复处理同一个文件
  const processingFileRef = useRef<string | null>(null);

  // Handle Tauri drag events (Tauri 2.0 API)
  useEffect(() => {
    // 在 useEffect 中检查 Tauri 环境
    const checkTauri = async () => {
      if (typeof window === 'undefined') return false;

      // 方式1: 检查 __TAURI__
      if ('__TAURI__' in window) {
        return true;
      }

      // 方式2: 尝试获取 webview
      try {
        const { getCurrentWebview } = await import('@tauri-apps/api/webview');
        getCurrentWebview();
        return true;
      } catch {
        return false;
      }
    };

    if (dragDropSetupRef.current) return;
    dragDropSetupRef.current = true;

    let unlisten: (() => void) | undefined;

    checkTauri().then(async (isTauriEnv) => {
      if (!isTauriEnv) return;

      try {
        const { getCurrentWebview } = await import('@tauri-apps/api/webview');
        const webview = getCurrentWebview();

        unlisten = await webview.onDragDropEvent(async (event) => {
          const payload = event.payload as { type: string; paths?: string[] };
          const { type, paths } = payload;

          if (type === 'enter' || type === 'over') {
            setIsDragging(true);
          } else if (type === 'leave') {
            setIsDragging(false);
          } else if (type === 'drop') {
            setIsDragging(false);

            // 确保 paths 存在
            if (!paths || paths.length === 0) {
              return;
            }

            // 显示加载状态
            const totalPaths = paths.length;
            setLoadingFileCount(totalPaths);
            setLoadingFileIndex(0);
            setIsLoadingFiles(true);

            const files: File[] = [];
            let fileIndex = 0;

            for (const path of paths) {
              if (processingFileRef.current === path) {
                continue;
              }
              processingFileRef.current = path;

              // 更新进度
              setLoadingFileIndex(++fileIndex);

              try {
                const contents = await readFile(path);
                const name = path.split(/[/\\]/).pop() || 'unknown';
                if (name.toLowerCase().endsWith('.mp4') || name.toLowerCase() === 'event.json') {
                  const blob = new Blob([contents], { type: name.endsWith('.mp4') ? 'video/mp4' : 'application/json' });
                  files.push(new File([blob], name));
                }
              } catch {
                try {
                  const entries = await readDir(path);
                  for (const entry of entries) {
                    const fullPath = await resolve(path, entry.name);
                    const entryName = entry.name;
                    if (entryName.toLowerCase().endsWith('.mp4') || entryName.toLowerCase() === 'event.json') {
                      try {
                        const contents = await readFile(fullPath);
                        const blob = new Blob([contents], { type: entryName.endsWith('.mp4') ? 'video/mp4' : 'application/json' });
                        files.push(new File([blob], entryName));
                      } catch (e) {
                        console.error('Error reading file:', fullPath, e);
                      }
                    }
                  }
                } catch (e) {
                  console.error('Error reading directory:', path, e);
                }
              }

              setTimeout(() => {
                if (processingFileRef.current === path) {
                  processingFileRef.current = null;
                }
              }, 500);
            }

            // 隐藏加载状态
            setIsLoadingFiles(false);

            if (files.length > 0) {
              onFilesAdded(files);
            }
          }
        });
      } catch (error) {
        console.error('[Tauri DragDrop] Setup error:', error);
      }
    });

    return () => {
      unlisten?.();
    };
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    // 非 Tauri 环境才处理
    if (typeof window === 'undefined' || !('__TAURI__' in window)) {
      setIsDragging(true);
    }
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    // 非 Tauri 环境才处理
    if (typeof window === 'undefined' || !('__TAURI__' in window)) {
      setIsDragging(false);
    }
  }, []);

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);

      const items = e.dataTransfer.items;
      const files: File[] = [];

      // Handle directory drops
      const processEntry = async (entry: FileSystemEntry): Promise<void> => {
        if (entry.isFile) {
          const fileEntry = entry as FileSystemFileEntry;
          const file = await new Promise<File>((resolve, reject) => {
            fileEntry.file(resolve, reject);
          });
          const name = file.name.toLowerCase();
          if (name.endsWith('.mp4') || name === 'event.json') {
            files.push(file);
          }
        } else if (entry.isDirectory) {
          const dirEntry = entry as FileSystemDirectoryEntry;
          const reader = dirEntry.createReader();
          const entries = await new Promise<FileSystemEntry[]>((resolve, reject) => {
            reader.readEntries(resolve, reject);
          });
          await Promise.all(entries.map(processEntry));
        }
      };

      // Process all dropped items
      const entries: FileSystemEntry[] = [];
      for (let i = 0; i < items.length; i++) {
        const entry = items[i].webkitGetAsEntry?.();
        if (entry) {
          entries.push(entry);
        }
      }

      if (entries.length > 0) {
        await Promise.all(entries.map(processEntry));
      } else {
        // Fallback for browsers without webkitGetAsEntry
        const droppedFiles = Array.from(e.dataTransfer.files).filter((f) => {
          const name = f.name.toLowerCase();
          return name.endsWith('.mp4') || name === 'event.json';
        });
        files.push(...droppedFiles);
      }

      if (files.length > 0) {
        onFilesAdded(files);
      }
    },
    [onFilesAdded]
  );

  const handleFileInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files || []).filter((f) => {
        const name = f.name.toLowerCase();
        return name.endsWith('.mp4') || name === 'event.json';
      });
      if (files.length > 0) {
        onFilesAdded(files);
      }
    },
    [onFilesAdded]
  );

  // Sample Tesla file names for visual hint
  const sampleFiles = [
    '2026-01-24_18-40-57-front.mp4',
    '2026-01-24_18-41-57-front.mp4',
    '2026-01-24_18-40-57-back.mp4',
    '2026-01-24_18-40-57-left_repeater.mp4',
    '2026-01-24_18-40-57-right_repeater.mp4',
    '2026-01-24_18-40-57-left_pillar.mp4',
    '2026-01-24_18-40-57-right_pillar.mp4',
  ];

  // 构建组件内容
  const dropZoneContent = hasVideos ? (
    <div
      className={`border-2 border-dashed rounded-lg p-4 text-center transition-colors ${
        isDragging ? 'border-blue-500 bg-blue-500/10' : 'border-gray-600 hover:border-gray-500'
      }`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
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
    </div>
  ) : (
    <div
      className={`border-2 border-dashed rounded-xl p-12 text-center transition-all relative overflow-hidden ${
        isDragging
          ? 'border-blue-500 bg-blue-500/10 scale-[1.02]'
          : 'border-gray-600 hover:border-gray-500'
      }`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Decorative file list preview */}
      <div className="absolute -right-4 top-1/2 -translate-y-1/2 rotate-3 opacity-40 pointer-events-none select-none">
        <div className="bg-gray-800 rounded-lg p-3 shadow-2xl border border-gray-700 text-left w-72">
          <div className="flex items-center gap-2 mb-2 pb-2 border-b border-gray-700">
            <span className="text-[10px] text-gray-400 font-medium w-full">Name</span>
            <span className="text-[10px] text-gray-400 font-medium w-16 text-right">Size</span>
          </div>
          {sampleFiles.map((file, i) => (
            <div key={i} className="flex items-center gap-2 py-0.5">
              <svg className="w-3 h-3 text-gray-500 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                <path d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4z" />
              </svg>
              <span className="text-[9px] text-gray-300 font-mono truncate">{file}</span>
              <span className="text-[9px] text-gray-500 w-12 text-right flex-shrink-0">80 MB</span>
            </div>
          ))}
          <div className="text-[9px] text-gray-600 mt-1">...</div>
        </div>
      </div>

      <div className="flex flex-col items-center gap-4 relative z-10">
        <div className="w-16 h-16 rounded-full bg-gray-800 flex items-center justify-center">
          <svg
            className="w-8 h-8 text-gray-400"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
            />
          </svg>
        </div>
        <div className="text-center">
          <p className="text-xl font-medium text-gray-200">Drop your TeslaCam clips here</p>
          <p className="text-sm text-gray-500 mt-2 max-w-md">
            From your Tesla USB drive, navigate to{' '}
            <span className="text-gray-400 font-mono text-xs">TeslaCam</span> →{' '}
            <span className="text-gray-400 font-mono text-xs">SavedClips</span>,{' '}
            <span className="text-gray-400 font-mono text-xs">SentryClips</span>, or{' '}
            <span className="text-gray-400 font-mono text-xs">RecentClips</span>
            {' '}→ select a dated folder and drop all clips
          </p>
        </div>
        <div className="flex items-center gap-3 mt-4">
          <label className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg cursor-pointer transition-colors">
            <span>Browse Files</span>
            <input
              type="file"
              accept="video/mp4,application/json"
              multiple
              onChange={handleFileInput}
              className="hidden"
            />
          </label>
          <label className="px-6 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg cursor-pointer transition-colors border border-gray-600">
            <span>Import Folder</span>
            <input
              type="file"
              {...({ webkitdirectory: "", directory: "" } as React.InputHTMLAttributes<HTMLInputElement>)}
              onChange={handleFileInput}
              className="hidden"
            />
          </label>
        </div>
      </div>
    </div>
  );

  // 如果正在加载，显示加载覆盖层
  if (isLoadingFiles) {
    const percentage = loadingFileCount > 0 ? Math.round((loadingFileIndex / loadingFileCount) * 100) : 0;
    return (
      <div className="relative">
        {dropZoneContent}
        <div className="absolute inset-0 z-50 bg-gray-950/90 backdrop-blur-sm flex items-center justify-center rounded-xl">
          <div className="max-w-sm w-full mx-4 text-center">
            <div className="w-16 h-16 mx-auto rounded-2xl bg-blue-600 flex items-center justify-center mb-4">
              <svg className="w-8 h-8 animate-pulse text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
              </svg>
            </div>
            <h2 className="text-xl font-semibold text-white mb-2">读取文件中...</h2>
            <p className="text-gray-400 text-sm mb-4">
              正在读取 {loadingFileIndex} / {loadingFileCount} 个文件
            </p>
            <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-blue-600 to-blue-500 rounded-full transition-all duration-300 ease-out"
                style={{ width: `${percentage}%` }}
              />
            </div>
            <p className="text-gray-500 text-xs mt-4">
              请稍候...
            </p>
          </div>
        </div>
      </div>
    );
  }

  return dropZoneContent;
}
