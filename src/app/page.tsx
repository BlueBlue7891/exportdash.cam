'use client';

import { useState, useCallback } from 'react';
import { open } from '@tauri-apps/plugin-shell';
import { DropZone } from '@/components/DropZone';
import { VideoPlayer } from '@/components/VideoPlayer';
import { LoadingScreen } from '@/components/LoadingScreen';
import { VideoBrowser } from '@/components/VideoBrowser';
import { VideoSequence, VideoMoment, TeslaEvent, ProcessingProgress } from '@/types/video';
import { FolderStructure, parseFolderStructure, parseFolderStructureAsync, TimeSlot } from '@/types/folder';
import { processFilesToMoments, detectSequences } from '@/lib/sequence-detector';
import { useLanguage } from '@/lib/i18n';

const openExternalLink = (url: string) => {
  open(url);
};

export default function Home() {
  const { t, language } = useLanguage();
  const [sequences, setSequences] = useState<VideoSequence[]>([]);
  const [selectedSequence, setSelectedSequence] = useState<VideoSequence | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingProgress, setProcessingProgress] = useState<ProcessingProgress>({
    stage: 'scanning',
    current: 0,
    total: 0,
  });
  
  // Folder import state
  const [folderStructure, setFolderStructure] = useState<FolderStructure | null>(null);
  const [showVideoBrowser, setShowVideoBrowser] = useState(false);
  // Persist selected time slots across calendar opens (keyed by date_time)
  // Selection persists after import to remind user what's been imported
  const [selectedTimeSlotIds, setSelectedTimeSlotIds] = useState<Set<string>>(new Set());

  // Handle scan progress from DropZone
  const handleScanProgress = useCallback((current: number, total: number) => {
    // Only show processing if we have files to process
    if (total > 0) {
      setIsProcessing(true);
      setProcessingProgress({
        stage: 'scanning',
        current,
        total,
        message: t.home.scanning,
      });
    }
  }, []);

  const handleFilesAdded = useCallback(async (newFiles: File[]) => {
    if (newFiles.length === 0) return;
    
    // Check if this looks like a folder import (has directory structure)
    const hasDirectoryStructure = newFiles.some(f => f.webkitRelativePath && f.webkitRelativePath.includes('/'));
    
    if (hasDirectoryStructure) {
      // Show loading for folder parsing
      setIsProcessing(true);
      setProcessingProgress({
        stage: 'scanning',
        current: 0,
        total: newFiles.length,
        message: t.home.parsingFolder,
      });
      
      // Parse folder structure asynchronously with progress
      const structure = await parseFolderStructureAsync(newFiles, (current, total) => {
        setProcessingProgress(prev => ({
          ...prev,
          current,
          total,
          message: `${t.home.parsingFolder} ${current}/${total}`,
        }));
      });
      
      setFolderStructure(structure);
      setIsProcessing(false);
      setShowVideoBrowser(true);
      return;
    }

    // Start processing
    setIsProcessing(true);
    setProcessingProgress({
      stage: 'scanning',
      current: 0,
      total: newFiles.length,
      message: t.home.scanning,
    });

    try {
      // Process files into moments (also parses event.json files)
      const { moments, events } = await processFilesToMoments(newFiles, setProcessingProgress);

      // Detect sequences from moments, matching events to sequences
      const detectedSequences = detectSequences(moments, events);

      // Update state
      setSequences(detectedSequences);

      // Auto-select first sequence if none selected
      if (detectedSequences.length > 0) {
        setSelectedSequence(detectedSequences[0]);
      }
    } catch (error) {
      console.error('Error processing videos:', error);
      setProcessingProgress({
        stage: 'error',
        current: 0,
        total: newFiles.length,
        message: t.common.error,
      });
    } finally {
      setIsProcessing(false);
    }
  }, []);
  
  const handleSelectTimeSlot = useCallback(async (timeSlot: TimeSlot | TimeSlot[], sequenceIdToReplace?: string) => {
    // Handle both single slot and array of slots
    const timeSlots = Array.isArray(timeSlot) ? timeSlot : [timeSlot];
    
    // Build a set of already imported file paths for quick lookup
    const importedFilePaths = new Set<string>();
    for (const seq of sequences) {
      for (const moment of seq.moments) {
        for (const video of moment.videos) {
          const path = (video.file as any).webkitRelativePath || (video.file as any).tauriPath || video.file.name;
          importedFilePaths.add(path);
        }
      }
    }
    
    // Check if any new files have GPS data (event.json)
    let hasNewGpsData = false;
    for (const slot of timeSlots) {
      const files = Object.values(slot.files);
      const firstVideo = files[0];
      if (!firstVideo) continue;
      
      const videoPath = (firstVideo as any).webkitRelativePath || (firstVideo as any).tauriPath || '';
      const normalizedVideoPath = videoPath.replace(/\\/g, '/');
      const videoDir = normalizedVideoPath.substring(0, normalizedVideoPath.lastIndexOf('/'));
      
      // Find event.json in the same directory
      const eventJson = folderStructure?.allFiles.find(f => {
        if (f.name !== 'event.json') return false;
        const eventPath = (f as any).webkitRelativePath || (f as any).tauriPath || '';
        const normalizedEventPath = eventPath.replace(/\\/g, '/');
        const eventDir = normalizedEventPath.substring(0, normalizedEventPath.lastIndexOf('/'));
        return eventDir === videoDir;
      });
      
      if (eventJson) {
        // Check if any video from this slot is new
        const hasNewVideo = files.some(f => {
          const fp = (f as any).webkitRelativePath || (f as any).tauriPath || f.name;
          return !importedFilePaths.has(fp);
        });
        if (hasNewVideo) {
          hasNewGpsData = true;
          break;
        }
      }
    }
    
    // If adding GPS data, do full re-import of all selected files
    // Otherwise use incremental import
    const useFullImport = hasNewGpsData;
    
    // Collect files from selected time slots
    let newFiles: File[] = [];
    const processedDirs = new Set<string>();
    let skippedCount = 0;
    
    for (const slot of timeSlots) {
      const files = Object.values(slot.files);
      
      for (const file of files) {
        const filePath = (file as any).webkitRelativePath || (file as any).tauriPath || file.name;
        if (!useFullImport && importedFilePaths.has(filePath)) {
          // Skip already imported files for incremental import
          skippedCount++;
        } else {
          newFiles.push(file);
        }
      }
      
      // Get the directory path from the first video file to find event.json
      if (files.length > 0) {
        const firstVideo = files[0];
        const videoPath = (firstVideo as any).webkitRelativePath || (firstVideo as any).tauriPath || '';
        const normalizedVideoPath = videoPath.replace(/\\/g, '/');
        const videoDir = normalizedVideoPath.substring(0, normalizedVideoPath.lastIndexOf('/'));
        
        if (!processedDirs.has(videoDir)) {
          processedDirs.add(videoDir);
          
          // Find event.json in the same directory
          const eventJson = folderStructure?.allFiles.find(f => {
            if (f.name !== 'event.json') return false;
            const eventPath = (f as any).webkitRelativePath || (f as any).tauriPath || '';
            const normalizedEventPath = eventPath.replace(/\\/g, '/');
            const eventDir = normalizedEventPath.substring(0, normalizedEventPath.lastIndexOf('/'));
            return eventDir === videoDir;
          });
          
          if (eventJson) {
            // For full import, always add event.json
            // For incremental, only add if there's new video in this directory
            const shouldAddEvent = useFullImport || files.some(f => {
              const fp = (f as any).webkitRelativePath || (f as any).tauriPath || f.name;
              return !importedFilePaths.has(fp);
            });
            if (shouldAddEvent) {
              newFiles.push(eventJson);
            }
          }
        }
      }
    }
    
    // Collect existing moments from sequences that are not being replaced
    // and whose files are still in the selection
    const selectedTimeSlotIds = new Set(timeSlots.map(ts => {
      // Build time slot ID from files
      const firstFile = Object.values(ts.files)[0];
      if (!firstFile) return '';
      const match = firstFile.name.match(/^(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})/);
      if (!match) return '';
      const [, year, month, day, hour, minute, second] = match;
      return `${year}-${month}-${day}_${hour}-${minute}-${second}`;
    }).filter(Boolean));
    
    // Collect moments and events to keep from the sequence being updated
    // Only for incremental import (not when adding GPS data)
    let existingMomentsToKeep: VideoMoment[] = [];
    let existingEventsToKeep: TeslaEvent[] = [];
    
    if (!useFullImport && sequenceIdToReplace) {
      const sequenceToUpdate = sequences.find(seq => seq.id === sequenceIdToReplace);
      if (sequenceToUpdate) {
        // Keep the event from this sequence if it exists
        if (sequenceToUpdate.event) {
          existingEventsToKeep.push(sequenceToUpdate.event);
        }
        for (const moment of sequenceToUpdate.moments) {
          const momentId = `${moment.date}_${moment.time.replace(/:/g, '-')}`;
          if (selectedTimeSlotIds.has(momentId)) {
            // This moment is still selected, keep it
            existingMomentsToKeep.push(moment);
          }
        }
      }
    }
    
    // If no new files and no existing moments to keep, nothing to do
    if (newFiles.length === 0 && existingMomentsToKeep.length === 0) {
      setShowVideoBrowser(false);
      return;
    }
    
    // Close browser before processing
    setShowVideoBrowser(false);
    // Mark selected slots as imported
    setIsProcessing(true);
    
    const totalFilesToProcess = newFiles.length + existingMomentsToKeep.length;
    setProcessingProgress({
      stage: 'scanning',
      current: 0,
      total: totalFilesToProcess,
      message: useFullImport 
        ? t.home.processing
        : skippedCount > 0 
          ? `${t.home.processing} (${skippedCount} skipped)`
          : t.home.scanning,
    });

    try {
      let allMoments: VideoMoment[] = [...existingMomentsToKeep];
      let allEvents: TeslaEvent[] = [...existingEventsToKeep];
      
      // Process only new files
      if (newFiles.length > 0) {
        const { moments: newMoments, events: newEvents } = await processFilesToMoments(newFiles, setProcessingProgress);
        allMoments = [...allMoments, ...newMoments];
        allEvents = [...allEvents, ...newEvents];
      }
      
      // Sort all moments by timestamp
      allMoments.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
      
      const detectedSequences = detectSequences(allMoments, allEvents);
      
      if (sequenceIdToReplace && sequences.length > 0) {
        // Replace only the specified sequence, keep others
        // Note: detectedSequences may contain multiple sequences if selected videos are not continuous
        
        // Build new sequences: keep non-replaced sequences + all newly detected sequences
        const keptSequences = sequences.filter(seq => 
          seq.id !== sequenceIdToReplace
        );
        
        // Combine kept sequences with all detected sequences
        let newSequences: VideoSequence[] = [...keptSequences, ...detectedSequences];
        
        // Remove duplicates by ID
        const seenIds = new Set<string>();
        newSequences = newSequences.filter(seq => {
          if (seenIds.has(seq.id)) return false;
          seenIds.add(seq.id);
          return true;
        });
        
        // Check containment and remove contained sequences iteratively until stable
        // This handles cases like: A contains B, B contains C, etc.
        let changed = true;
        while (changed) {
          changed = false;
          const filtered: VideoSequence[] = [];
          for (const seq of newSequences) {
            // Check if this sequence is contained by any other sequence in the list
            const isContained = newSequences.some(other => 
              other.id !== seq.id && sequenceContains(other, seq)
            );
            if (!isContained) {
              filtered.push(seq);
            } else {
              changed = true;
            }
          }
          newSequences = filtered;
        }
        
        setSequences(newSequences);
        
        // Keep current selection if it's not the replaced sequence
        // Otherwise update to the replacement sequence
        const currentSelectedId = selectedSequence?.id;
        if (currentSelectedId && currentSelectedId !== sequenceIdToReplace) {
          // Current selection is not the replaced one, keep it (if still exists)
          const stillExists = newSequences.some(seq => seq.id === currentSelectedId);
          if (!stillExists && newSequences.length > 0) {
            // Current selection was removed (contained by another), select first
            setSelectedSequence(newSequences[0]);
          }
          // Otherwise keep current selection (already in state)
        } else if (currentSelectedId === sequenceIdToReplace) {
          // Current selection was replaced, update to replacement
          const replacementInNew = newSequences.find(seq => 
            detectedSequences.some(ds => ds.id === seq.id)
          );
          if (replacementInNew) {
            setSelectedSequence(replacementInNew);
          } else if (newSequences.length > 0) {
            setSelectedSequence(newSequences[0]);
          }
        }
        // If no current selection, don't auto-select (keep as is)
      } else {
        // No sequence to replace, set all detected sequences
        setSequences(detectedSequences);
        // Only auto-select if nothing is currently selected
        if (!selectedSequence && detectedSequences.length > 0) {
          setSelectedSequence(detectedSequences[0]);
        }
      }
    } catch (error) {
      console.error('Error processing videos:', error);
    } finally {
      setIsProcessing(false);
    }
  }, [folderStructure, sequences, selectedSequence]);

  const handleClear = useCallback(() => {
    setSequences([]);
    setSelectedSequence(null);
    setFolderStructure(null);
    setSelectedTimeSlotIds(new Set());

  }, []);

  // Delete a specific sequence
  const handleDeleteSequence = useCallback((sequenceId: string) => {
    setSequences(prev => {
      const newSequences = prev.filter(seq => seq.id !== sequenceId);
      // Update selected sequence if the deleted one was selected
      if (selectedSequence?.id === sequenceId) {
        setSelectedSequence(newSequences.length > 0 ? newSequences[0] : null);
      }
      return newSequences;
    });
  }, [selectedSequence]);

  // Check if sequence A contains all moments of sequence B
  const sequenceContains = useCallback((container: VideoSequence, contained: VideoSequence): boolean => {
    if (contained.moments.length === 0) return true;
    if (container.moments.length < contained.moments.length) return false;
    // Build a set of moment IDs from container (use moment.id for accuracy)
    const containerMomentIds = new Set(container.moments.map(m => m.id));
    // Check if all moments of contained are in container
    return contained.moments.every(m => containerMomentIds.has(m.id));
  }, []);

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      {/* Loading Screen */}
      {isProcessing && <LoadingScreen progress={processingProgress} />}

      {/* Header with version */}
      <header className="px-4 py-2 bg-gray-900/50 border-b border-gray-800 flex items-center justify-between">
        <div className="flex items-end gap-2">
          <img src="/icon.png" alt="ExportDash" className="w-6 h-6" />
          <div className="flex items-baseline gap-1.5">
            <span className="font-semibold text-gray-200">ExportDashCam</span>
            <span className="text-[10px] text-gray-500">v0.2.3</span>
          </div>
        </div>
      </header>

      {/* Main Content - Full width */}
      <main className="p-4">
        {sequences.length === 0 ? (
          /* Empty State */
          <div className="max-w-4xl mx-auto">
            <DropZone onFilesAdded={handleFilesAdded} hasVideos={false} onScanProgress={handleScanProgress} />

            {/* Features */}
            <div className="mt-12 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {/* Privacy First */}
              <div className="bg-gray-900/50 rounded-xl p-5 border border-gray-800">
                <div className="w-10 h-10 rounded-lg bg-emerald-600/20 flex items-center justify-center mb-3">
                  <svg className="w-5 h-5 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                  </svg>
                </div>
                <h3 className="font-semibold mb-1">100% {language === 'zh' ? '私密' : 'Private'}</h3>
                <p className="text-sm text-gray-500">{language === 'zh' ? '所有处理在您设备内完成。无上传，无服务器，无追踪' : 'Everything runs locally on your device. No uploads, no servers, no tracking.'}</p>
              </div>

              {/* Seamless Playback */}
              <div className="bg-gray-900/50 rounded-xl p-5 border border-gray-800 relative overflow-hidden">
                <img
                  src="/features/playback.png"
                  alt=""
                  className="absolute -right-2 top-1 w-28 rotate-6 opacity-100 pointer-events-none rounded-lg shadow-lg"
                />
                <div className="relative z-10">
                  <div className="w-10 h-10 rounded-lg bg-blue-600/20 flex items-center justify-center mb-3">
                    <svg className="w-5 h-5 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                  <h3 className="font-semibold mb-1">{language === 'zh' ? '无缝播放' : 'Seamless Playback'}</h3>
                  <p className="text-sm text-gray-500">{language === 'zh' ? '连续片段合并为流畅视频' : 'Consecutive clips merged into continuous video'}</p>
                </div>
              </div>

              {/* Live Telemetry */}
              <div className="bg-gray-900/50 rounded-xl p-5 border border-gray-800 relative overflow-hidden">
                <img
                  src="/features/telemetry.png"
                  alt=""
                  className="absolute -right-2 top-1 w-28 rotate-6 opacity-100 pointer-events-none rounded-lg shadow-lg"
                />
                <div className="relative z-10">
                  <div className="w-10 h-10 rounded-lg bg-yellow-600/20 flex items-center justify-center mb-3">
                    <svg className="w-5 h-5 text-yellow-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                    </svg>
                  </div>
                  <h3 className="font-semibold mb-1">{t.home.features.liveTelemetry.title}</h3>
                  <p className="text-sm text-gray-500">{t.home.features.liveTelemetry.desc}</p>
                </div>
              </div>

              {/* All 6 Cameras */}
              <div className="bg-gray-900/50 rounded-xl p-5 border border-gray-800 relative overflow-hidden">
                <img
                  src="/features/cameras.png"
                  alt=""
                  className="absolute -right-4 -top-1 w-32 rotate-6 opacity-100 pointer-events-none rounded-lg shadow-lg"
                />
                <div className="relative z-10">
                  <div className="w-10 h-10 rounded-lg bg-purple-600/20 flex items-center justify-center mb-3">
                    <svg className="w-5 h-5 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
                    </svg>
                  </div>
                  <h3 className="font-semibold mb-1">{t.home.features.all6Cameras.title}</h3>
                  <p className="text-sm text-gray-500">{t.home.features.all6Cameras.desc}</p>
                </div>
              </div>

              {/* Interactive Map */}
              <div className="bg-gray-900/50 rounded-xl p-5 border border-gray-800 relative overflow-hidden">
                <img
                  src="/features/map.png"
                  alt=""
                  className="absolute -right-4 -top-2 w-24 rotate-6 opacity-100 pointer-events-none rounded-lg shadow-lg"
                />
                <div className="relative z-10">
                  <div className="w-10 h-10 rounded-lg bg-green-600/20 flex items-center justify-center mb-3">
                    <svg className="w-5 h-5 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                  </div>
                  <h3 className="font-semibold mb-1">{t.home.features.interactiveMap.title}</h3>
                  <p className="text-sm text-gray-500">{t.home.features.interactiveMap.desc}</p>
                </div>
              </div>

              {/* Event Timeline */}
              <div className="bg-gray-900/50 rounded-xl p-5 border border-gray-800 relative overflow-hidden">
                <img
                  src="/features/timeline.png"
                  alt=""
                  className="absolute -right-6 top-1 w-28 rotate-6 opacity-100 pointer-events-none rounded-lg shadow-lg"
                />
                <div className="relative z-10">
                  <div className="w-10 h-10 rounded-lg bg-orange-600/20 flex items-center justify-center mb-3">
                    <svg className="w-5 h-5 text-orange-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                    </svg>
                  </div>
                  <h3 className="font-semibold mb-1">{t.home.features.eventTimeline.title}</h3>
                  <p className="text-sm text-gray-500">{t.home.features.eventTimeline.desc}</p>
                </div>
              </div>

              {/* Video Editor */}
              <div className="bg-gray-900/50 rounded-xl p-5 border border-gray-800 relative overflow-hidden">
                <img
                  src="/features/trim.png"
                  alt=""
                  className="absolute -right-2 top-1 w-28 rotate-6 opacity-100 pointer-events-none rounded-lg shadow-lg"
                />
                <div className="relative z-10">
                  <div className="w-10 h-10 rounded-lg bg-yellow-600/20 flex items-center justify-center mb-3">
                    <svg className="w-5 h-5 text-yellow-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.121 14.121L19 19m-7-7l7-7m-7 7l-2.879 2.879M12 12L9.121 9.121m0 5.758a3 3 0 10-4.243 4.243 3 3 0 004.243-4.243zm0-5.758a3 3 0 10-4.243-4.243 3 3 0 004.243 4.243z" />
                    </svg>
                  </div>
                  <h3 className="font-semibold mb-1">{t.home.features.videoEditor.title}</h3>
                  <p className="text-sm text-gray-500">{t.home.features.videoEditor.desc}</p>
                </div>
              </div>

              {/* Camera Track */}
              <div className="bg-gray-900/50 rounded-xl p-5 border border-gray-800 relative overflow-hidden">
                <img
                  src="/features/camera-track.png"
                  alt=""
                  className="absolute -right-4 -top-1 w-32 rotate-6 opacity-100 pointer-events-none rounded-lg shadow-lg"
                />
                <div className="relative z-10">
                  <div className="w-10 h-10 rounded-lg bg-purple-600/20 flex items-center justify-center mb-3">
                    <svg className="w-5 h-5 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                  </div>
                  <h3 className="font-semibold mb-1">{t.home.features.cameraTrack.title}</h3>
                  <p className="text-sm text-gray-500">{t.home.features.cameraTrack.desc}</p>
                </div>
              </div>

              {/* Video Export */}
              <div className="bg-gray-900/50 rounded-xl p-5 border border-gray-800">
                <div className="w-10 h-10 rounded-lg bg-red-600/20 flex items-center justify-center mb-3">
                  <svg className="w-5 h-5 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                </div>
                <h3 className="font-semibold mb-1">{t.home.features.videoExport.title}</h3>
                <p className="text-sm text-gray-500">{t.home.features.videoExport.desc}</p>
              </div>

            </div>

            {/* Credits */}
            <div className="mt-16 pt-8 border-t border-gray-800 text-center">
              <p className="text-xs text-gray-600">
                {t.footer.mitLicense} ·{' '}
                <button
                  onClick={() => openExternalLink('https://github.com/BlueBlue7891/exportdash.cam')}
                  className="text-gray-500 hover:text-gray-400 underline underline-offset-2 bg-transparent border-none cursor-pointer"
                >
                  {t.footer.openSource}
                </button>
                {' '}· {t.footer.builtWith}{' '}
                <button
                  onClick={() => openExternalLink('https://claude.ai/code')}
                  className="text-gray-500 hover:text-gray-400 relative pl-5 bg-transparent border-none cursor-pointer"
                >
                  <svg className="w-3.5 h-3.5 absolute left-0 top-[2px]" viewBox="0 0 248 248" fill="none">
                    <path d="M52.4285 162.873L98.7844 136.879L99.5485 134.602L98.7844 133.334H96.4921L88.7237 132.862L62.2346 132.153L39.3113 131.207L17.0249 130.026L11.4214 128.844L6.2 121.873L6.7094 118.447L11.4214 115.257L18.171 115.847L33.0711 116.911L55.485 118.447L71.6586 119.392L95.728 121.873H99.5485L100.058 120.337L98.7844 119.392L97.7656 118.447L74.5877 102.732L49.4995 86.1905L36.3823 76.62L29.3779 71.7757L25.8121 67.2858L24.2839 57.3608L30.6515 50.2716L39.3113 50.8623L41.4763 51.4531L50.2636 58.1879L68.9842 72.7209L93.4357 90.6804L97.0015 93.6343L98.4374 92.6652L98.6571 91.9801L97.0015 89.2625L83.757 65.2772L69.621 40.8192L63.2534 30.6579L61.5978 24.632C60.9565 22.1032 60.579 20.0111 60.579 17.4246L67.8381 7.49965L71.9133 6.19995L81.7193 7.49965L85.7946 11.0443L91.9074 24.9865L101.714 46.8451L116.996 76.62L121.453 85.4816L123.873 93.6343L124.764 96.1155H126.292V94.6976L127.566 77.9197L129.858 57.3608L132.15 30.8942L132.915 23.4505L136.608 14.4708L143.994 9.62643L149.725 12.344L154.437 19.0788L153.8 23.4505L150.998 41.6463L145.522 70.1215L141.957 89.2625H143.994L146.414 86.7813L156.093 74.0206L172.266 53.698L179.398 45.6635L187.803 36.802L193.152 32.5484H203.34L210.726 43.6549L207.415 55.1159L196.972 68.3492L188.312 79.5739L175.896 96.2095L168.191 109.585L168.882 110.689L170.738 110.53L198.755 104.504L213.91 101.787L231.994 98.7149L240.144 102.496L241.036 106.395L237.852 114.311L218.495 119.037L195.826 123.645L162.07 131.592L161.696 131.893L162.137 132.547L177.36 133.925L183.855 134.279H199.774L229.447 136.524L237.215 141.605L241.8 147.867L241.036 152.711L229.065 158.737L213.019 154.956L175.45 145.977L162.587 142.787H160.805V143.85L171.502 154.366L191.242 172.089L215.82 195.011L217.094 200.682L213.91 205.172L210.599 204.699L188.949 188.394L180.544 181.069L161.696 165.118H160.422V166.772L164.752 173.152L187.803 207.771L188.949 218.405L187.294 221.832L181.308 223.959L174.813 222.777L161.187 203.754L147.305 182.486L136.098 163.345L134.745 164.2L128.075 235.42L125.019 239.082L117.887 241.8L111.902 237.31L108.718 229.984L111.902 215.452L115.722 196.547L118.779 181.541L121.58 162.873L123.291 156.636L123.14 156.219L121.773 156.449L107.699 175.752L86.304 204.699L69.3663 222.777L65.291 224.431L58.2867 220.768L58.9235 214.27L62.8713 208.48L86.304 178.705L100.44 160.155L109.551 149.507L109.462 147.967L108.959 147.924L46.6977 188.512L35.6182 189.93L30.7788 185.44L31.4156 178.115L33.7079 175.752L52.4285 162.873Z" fill="#D97757"/>
                  </svg>
                  Claude Code
                </button>
                ,{' '}
                <button
                  onClick={() => openExternalLink('https://www.kimi.com/code')}
                  className="text-gray-500 hover:text-gray-400 bg-transparent border-none cursor-pointer"
                >
                  Kimi K2.5
                </button>
                {' '}{t.common.and}{' '}
                <button
                  onClick={() => openExternalLink('https://minimaxi.com/')}
                  className="text-gray-500 hover:text-gray-400 bg-transparent border-none cursor-pointer"
                >
                  MiniMax M2.5
                </button>
              </p>
              <p className="mt-2 text-xs text-gray-600">
                {t.footer.forkedFrom}{' '}
                <button
                  onClick={() => openExternalLink('https://github.com/nobig-deals/exportdash.cam')}
                  className="text-gray-500 hover:text-gray-400 underline underline-offset-2 bg-transparent border-none cursor-pointer"
                >
                  nobig-deals/exportdash.cam
                </button>
              </p>
              <p className="mt-2 text-xs text-gray-600">
                {t.footer.uses}{' '}
                <button
                  onClick={() => openExternalLink('https://github.com/teslamotors/dashcam')}
                  className="text-gray-500 hover:text-gray-400 underline underline-offset-2 bg-transparent border-none cursor-pointer"
                >
                  {t.footer.teslaSpec}
                </button>
                {' '}· {t.footer.inspiredBy}{' '}
                <button
                  onClick={() => openExternalLink('https://viewdash.cam/')}
                  className="text-gray-500 hover:text-gray-400 underline underline-offset-2 bg-transparent border-none cursor-pointer"
                >
                  ViewDash.cam
                </button>
              </p>

              {/* CTA */}
              <p className="mt-6 text-xs text-gray-600">
                {t.footer.cta}{' '}
                <button
                  onClick={() => openExternalLink('https://nobig.deals')}
                  className="text-gray-400 hover:text-gray-300 underline underline-offset-2 bg-transparent border-none cursor-pointer"
                >
                  {t.footer.contact}
                </button>
              </p>
            </div>
          </div>
        ) : (
          /* Full-width Video Player with integrated controls */
          <VideoPlayer
            sequences={sequences}
            selectedSequence={selectedSequence}
            onSelectSequence={setSelectedSequence}
            onClear={handleClear}
            onDeleteSequence={handleDeleteSequence}
            onAddFiles={handleFilesAdded}
            folderStructure={folderStructure}
            onOpenVideoBrowser={() => setShowVideoBrowser(true)}
          />
        )}
        
        {/* Video Browser Modal */}
        {showVideoBrowser && folderStructure && (
          <VideoBrowser
            folderStructure={folderStructure}
            onSelectTimeSlot={handleSelectTimeSlot}
            onClose={() => setShowVideoBrowser(false)}
            selectedTimeSlotIds={selectedTimeSlotIds}
            onSelectionChange={setSelectedTimeSlotIds}
            onClear={handleClear}
            currentSequence={selectedSequence}
          />
        )}
      </main>
    </div>
  );
}
