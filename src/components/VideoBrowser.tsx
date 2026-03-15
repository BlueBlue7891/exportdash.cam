'use client';

import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { 
  DateEntry, 
  TimeSlot, 
  hasAllCameras, 
  getCameraCount, 
  SOURCE_LABELS, 
  SOURCE_COLORS, 
  VideoSource 
} from '@/types/folder';

interface VideoBrowserProps {
  folderStructure: {
    dates: DateEntry[];
  };
  onSelectTimeSlot: (timeSlot: TimeSlot | TimeSlot[]) => void;
  onClose: () => void;
  // External selection state (persisted across opens)
  // Selection persists after import to remind user what's been imported
  selectedTimeSlotIds: Set<string>;
  onSelectionChange: (ids: Set<string>) => void;
  // Clear all videos from player
  onClear: () => void;
}

const ALL_SOURCES: VideoSource[] = ['recent', 'saved', 'sentry', 'encrypted', 'photobooth', 'unknown'];

const STORAGE_KEY_MONTH = 'videoBrowserLastMonth';
const STORAGE_KEY_DATE = 'videoBrowserLastDate';

type MonthState = { year: number; month: number };

// Complete badge color - distinct from Saved (green)
const COMPLETE_BADGE_COLOR = 'bg-teal-600/20 text-teal-400';

export function VideoBrowser({ folderStructure, onSelectTimeSlot, onClose, selectedTimeSlotIds, onSelectionChange, onClear }: VideoBrowserProps) {
  const [selectedSources, setSelectedSources] = useState<Set<VideoSource>>(new Set(ALL_SOURCES));
  
  // Draft selection state - independent from imported state
  // This allows user to play with selections without affecting imported videos
  const [draftSelection, setDraftSelection] = useState<Set<string>>(new Set(selectedTimeSlotIds));
  const [isDragging, setIsDragging] = useState(false);
  
  // Sync draft with external state when component opens/mounts or external state changes
  // This ensures that when reopening the browser, it shows the previously imported selections
  useEffect(() => {
    setDraftSelection(new Set(selectedTimeSlotIds));
  }, [selectedTimeSlotIds]);
  const [lastSelectedIndex, setLastSelectedIndex] = useState<number | null>(null);
  const dragStartRef = useRef<number | null>(null);
  const timeSlotRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  
  // Compute date range from folder structure
  const dateRange = useMemo(() => {
    if (folderStructure.dates.length === 0) return null;
    const sortedDates = [...folderStructure.dates].sort((a, b) => a.date.localeCompare(b.date));
    const earliest = sortedDates[0].date;
    const latest = sortedDates[sortedDates.length - 1].date;
    const [earliestYear, earliestMonth] = earliest.split('-').map(Number);
    const [latestYear, latestMonth] = latest.split('-').map(Number);
    return {
      earliest: { year: earliestYear, month: earliestMonth - 1, date: earliest },
      latest: { year: latestYear, month: latestMonth - 1, date: latest },
    };
  }, [folderStructure.dates]);
  
  // Compute available sources and their counts
  const sourceStats = useMemo(() => {
    const stats = new Map<VideoSource, number>();
    for (const source of ALL_SOURCES) {
      stats.set(source, 0);
    }
    
    for (const date of folderStructure.dates) {
      for (const slot of date.timeSlots) {
        for (const source of slot.sources) {
          stats.set(source, (stats.get(source) || 0) + 1);
        }
      }
    }
    return stats;
  }, [folderStructure.dates]);
  
  // Filter dates based on selected sources
  const filteredDates = useMemo(() => {
    return folderStructure.dates.map(date => ({
      ...date,
      timeSlots: date.timeSlots.filter(slot => 
        slot.sources.some(source => selectedSources.has(source))
      )
    })).filter(date => date.timeSlots.length > 0);
  }, [folderStructure.dates, selectedSources]);
  
  // Parse initial month and date
  const { initialMonth, initialDate } = useMemo(() => {
    if (typeof window !== 'undefined') {
      const savedMonth = localStorage.getItem(STORAGE_KEY_MONTH);
      const savedDate = localStorage.getItem(STORAGE_KEY_DATE);
      
      if (savedMonth && savedDate && dateRange) {
        try {
          const parsedMonth = JSON.parse(savedMonth);
          const savedTime = new Date(parsedMonth.year, parsedMonth.month).getTime();
          const earliestTime = new Date(dateRange.earliest.year, dateRange.earliest.month).getTime();
          const latestTime = new Date(dateRange.latest.year, dateRange.latest.month).getTime();
          
          if (savedTime >= earliestTime && savedTime <= latestTime) {
            const dateExists = folderStructure.dates.some(d => d.date === savedDate);
            if (dateExists) {
              return { initialMonth: parsedMonth, initialDate: savedDate };
            }
          }
        } catch {
          // Invalid saved data, ignore
        }
      }
    }
    
    if (dateRange) {
      return { 
        initialMonth: { year: dateRange.latest.year, month: dateRange.latest.month },
        initialDate: dateRange.latest.date
      };
    }
    const now = new Date();
    return { 
      initialMonth: { year: now.getFullYear(), month: now.getMonth() },
      initialDate: null
    };
  }, [dateRange, folderStructure.dates]);
  
  const [currentMonth, setCurrentMonth] = useState<MonthState>(initialMonth);
  const [selectedDate, setSelectedDate] = useState<string | null>(initialDate);
  
  // Save current month and date to localStorage
  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem(STORAGE_KEY_MONTH, JSON.stringify(currentMonth));
      if (selectedDate) {
        localStorage.setItem(STORAGE_KEY_DATE, selectedDate);
      }
    }
  }, [currentMonth, selectedDate]);

  // Get selected date entry (from filtered)
  const selectedDateEntry = useMemo(() => {
    if (!selectedDate) return null;
    return filteredDates.find(d => d.date === selectedDate) || null;
  }, [selectedDate, filteredDates]);
  
  // Flatten time slots for the selected date with index
  const timeSlotsWithIndex = useMemo(() => {
    if (!selectedDateEntry) return [];
    return selectedDateEntry.timeSlots.map((slot, index) => {
      // Parse timestamp for comparison with selectedSequence
      const [year, month, day] = selectedDateEntry.date.split('-').map(Number);
      const [hour, minute, second] = slot.time.split('-').map(Number);
      const timestamp = new Date(year, month - 1, day, hour, minute, second);
      
      return {
        ...slot,
        index,
        id: `${selectedDateEntry.date}_${slot.time}`,
        timestamp
      };
    });
  }, [selectedDateEntry]);

  // Parse dates with available videos and their source types
  const dateSources = useMemo(() => {
    const map = new Map<string, Set<VideoSource>>();
    for (const date of filteredDates) {
      const sources = new Set<VideoSource>();
      for (const slot of date.timeSlots) {
        for (const source of slot.sources) {
          sources.add(source);
        }
      }
      map.set(date.date, sources);
    }
    return map;
  }, [filteredDates]);

  // Generate calendar days
  const calendarDays = useMemo(() => {
    const { year, month } = currentMonth;
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const startPadding = firstDay.getDay();
    const daysInMonth = lastDay.getDate();
    
    const days: { day: number; dateStr: string; sources: VideoSource[] }[] = [];
    
    for (let i = 0; i < startPadding; i++) {
      days.push({ day: 0, dateStr: '', sources: [] });
    }
    
    for (let day = 1; day <= daysInMonth; day++) {
      const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const sources = dateSources.get(dateStr);
      days.push({
        day,
        dateStr,
        sources: sources ? Array.from(sources) : [],
      });
    }
    
    return days;
  }, [currentMonth, dateSources]);

  const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 
                      'July', 'August', 'September', 'October', 'November', 'December'];

  // Get all months that have video data
  const availableMonths = useMemo(() => {
    const months = new Set<string>();
    for (const date of folderStructure.dates) {
      const [year, month] = date.date.split('-');
      months.add(`${year}-${month}`);
    }
    return Array.from(months).sort();
  }, [folderStructure.dates]);

  // Find the next/previous month with data
  const findNearestMonth = (current: MonthState, direction: -1 | 1): MonthState | null => {
    const currentKey = `${current.year}-${String(current.month + 1).padStart(2, '0')}`;
    const currentIndex = availableMonths.indexOf(currentKey);
    
    if (currentIndex === -1) {
      // Current month not in list, find nearest
      for (let i = direction === 1 ? 0 : availableMonths.length - 1; 
           direction === 1 ? i < availableMonths.length : i >= 0; 
           i += direction) {
        const [y, m] = availableMonths[i].split('-').map(Number);
        const monthValue = y * 12 + (m - 1);
        const currentValue = current.year * 12 + current.month;
        if (direction === 1 ? monthValue > currentValue : monthValue < currentValue) {
          return { year: y, month: m - 1 };
        }
      }
      return null;
    }
    
    const newIndex = currentIndex + direction;
    if (newIndex >= 0 && newIndex < availableMonths.length) {
      const [y, m] = availableMonths[newIndex].split('-').map(Number);
      return { year: y, month: m - 1 };
    }
    return null;
  };

  const goToPreviousMonth = () => {
    if (isAtEarliest) return;
    const newMonth = findNearestMonth(currentMonth, -1);
    if (newMonth) {
      setCurrentMonth(newMonth);
    }
  };

  const goToNextMonth = () => {
    if (isAtLatest) return;
    const newMonth = findNearestMonth(currentMonth, 1);
    if (newMonth) {
      setCurrentMonth(newMonth);
    }
  };

  const goToEarliestMonth = () => {
    if (dateRange) {
      setCurrentMonth({ year: dateRange.earliest.year, month: dateRange.earliest.month });
      setSelectedDate(dateRange.earliest.date);
    }
  };

  const goToLatestMonth = () => {
    if (dateRange) {
      setCurrentMonth({ year: dateRange.latest.year, month: dateRange.latest.month });
      setSelectedDate(dateRange.latest.date);
    }
  };

  // Check if at boundaries
  const currentMonthValue = currentMonth.year * 12 + currentMonth.month;
  const earliestMonthValue = dateRange ? dateRange.earliest.year * 12 + dateRange.earliest.month : 0;
  const latestMonthValue = dateRange ? dateRange.latest.year * 12 + dateRange.latest.month : 0;
  const isAtEarliest = dateRange ? currentMonthValue <= earliestMonthValue : false;
  const isAtLatest = dateRange ? currentMonthValue >= latestMonthValue : false;

  const toggleSource = (source: VideoSource) => {
    setSelectedSources(prev => {
      const next = new Set(prev);
      if (next.has(source)) {
        next.delete(source);
      } else {
        next.add(source);
      }
      return next;
    });
    if (selectedDate && !filteredDates.find(d => d.date === selectedDate)) {
      setSelectedDate(null);
    }
  };

  const selectAllSources = () => {
    setSelectedSources(new Set(ALL_SOURCES));
  };

  const clearAllSources = () => {
    setSelectedSources(new Set());
    setSelectedDate(null);
  };

  // Store the initial selection state when drag starts
  const initialSelectionRef = useRef<Set<string>>(new Set());
  // Track if we're in "subtract mode" for drag (when starting drag on selected item)
  const isSubtractModeRef = useRef(false);
  // Track if we actually dragged (moved to another item)
  const hasDraggedRef = useRef(false);
  
  // Helper to update draft selection - only affects current browser session
  const updateSelection = useCallback((updater: Set<string> | ((prev: Set<string>) => Set<string>)) => {
    if (typeof updater === 'function') {
      setDraftSelection(updater(new Set(draftSelection)));
    } else {
      setDraftSelection(updater);
    }
  }, [draftSelection]);
  
  // Double click handler - select only this item
  const handleDoubleClick = useCallback((id: string, index: number) => {
    updateSelection(new Set([id]));
    setLastSelectedIndex(index);
  }, [updateSelection]);
  
  // Single click handler - toggle selection (add or remove)
  const handleRowClick = useCallback((id: string, index: number, e: React.MouseEvent) => {
    // If we dragged, don't process click
    if (hasDraggedRef.current) return;
    
    const isAlreadySelected = draftSelection.has(id);
    
    // Toggle: if selected, remove; if not selected, add
    updateSelection(prev => {
      const next = new Set(prev);
      if (isAlreadySelected) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
    setLastSelectedIndex(index);
  }, [draftSelection, updateSelection]);
  
  // Mouse down handler - prepare for potential drag
  const handleRowMouseDown = useCallback((id: string, index: number, e: React.MouseEvent) => {
    // Don't start drag on double-click
    if (e.detail > 1) return;
    
    e.preventDefault();
    
    const isAlreadySelected = draftSelection.has(id);
    
    setIsDragging(true);
    dragStartRef.current = index;
    hasDraggedRef.current = false;
    setLastSelectedIndex(index);
    
    // Determine mode: subtract mode if starting on selected item
    isSubtractModeRef.current = isAlreadySelected;
    
    // Store initial selection for drag operation
    initialSelectionRef.current = new Set(draftSelection);
  }, [draftSelection]);
  
  // Mouse enter handler during drag - add/remove items in drag range
  const handleRowMouseEnter = useCallback((id: string, index: number) => {
    if (isDragging && dragStartRef.current !== null) {
      // Mark that we actually dragged (not just clicked)
      if (index !== dragStartRef.current) {
        hasDraggedRef.current = true;
      }
      
      const start = Math.min(dragStartRef.current, index);
      const end = Math.max(dragStartRef.current, index);
      
      const newSelection = (() => {
        if (isSubtractModeRef.current) {
          // Subtract mode: remove items in drag range from initial selection
          const next = new Set(initialSelectionRef.current);
          for (let i = start; i <= end; i++) {
            const slotId = timeSlotsWithIndex[i]?.id;
            if (slotId) next.delete(slotId);
          }
          return next;
        } else {
          // Add mode: add items in drag range to initial selection
          const next = new Set(initialSelectionRef.current);
          for (let i = start; i <= end; i++) {
            const slotId = timeSlotsWithIndex[i]?.id;
            if (slotId) next.add(slotId);
          }
          return next;
        }
      })();
      updateSelection(newSelection);
    }
  }, [isDragging, timeSlotsWithIndex, updateSelection]);
  
  // Legacy handlers for compatibility
  const handleMouseDown = handleRowMouseDown;
  const handleMouseEnter = handleRowMouseEnter;

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
    dragStartRef.current = null;
  }, []);

  // Global mouse up handler to stop dragging
  useEffect(() => {
    const handleGlobalMouseUp = () => {
      setIsDragging(false);
      dragStartRef.current = null;
      // Reset hasDragged after a short delay so click handler can check it
      setTimeout(() => {
        hasDraggedRef.current = false;
      }, 50);
    };
    
    if (isDragging) {
      window.addEventListener('mouseup', handleGlobalMouseUp);
      return () => window.removeEventListener('mouseup', handleGlobalMouseUp);
    }
  }, [isDragging]);

  // Select all / Clear all time slots
  const selectAllTimeSlots = useCallback(() => {
    const allIds = timeSlotsWithIndex.map(slot => slot.id);
    updateSelection(new Set(allIds));
  }, [timeSlotsWithIndex, updateSelection]);

  const clearAllTimeSlots = useCallback(() => {
    updateSelection(new Set());
    setLastSelectedIndex(null);
  }, [updateSelection]);

  // Discard all selections and close browser (return to home)
  const discardSelections = useCallback(() => {
    updateSelection(new Set());
    setLastSelectedIndex(null);
    onClear();
  }, [updateSelection, onClear]);

  // Build a map of all time slots across all dates for cross-date import
  const allTimeSlotsMap = useMemo(() => {
    const map = new Map<string, TimeSlot>();
    for (const date of filteredDates) {
      for (const slot of date.timeSlots) {
        const id = `${date.date}_${slot.time}`;
        map.set(id, slot);
      }
    }
    return map;
  }, [filteredDates]);

  // Import selected time slots (from ALL dates, not just current date)
  const handleImport = useCallback(() => {
    // Collect selected slots from ALL dates using the map
    const selectedSlots: TimeSlot[] = [];
    for (const id of draftSelection) {
      const slot = allTimeSlotsMap.get(id);
      if (slot) {
        selectedSlots.push(slot);
      }
    }
    if (selectedSlots.length >= 1) {
      // Sync draft to external state (marks these as imported)
      onSelectionChange(new Set(draftSelection));
      // Pass array of selected slots for batch import
      onSelectTimeSlot(selectedSlots);
    }
  }, [draftSelection, allTimeSlotsMap, onSelectTimeSlot, onSelectionChange]);

  // Calculate total recordings after filter
  const totalRecordings = useMemo(() => {
    return filteredDates.reduce((sum, d) => sum + d.timeSlots.length, 0);
  }, [filteredDates]);

  const selectedCount = draftSelection.size;
  
  // Check if draft selection matches imported state (no changes made)
  const hasImportedSelections = selectedTimeSlotIds.size > 0;
  const isSelectionUnchanged = useMemo(() => {
    if (draftSelection.size !== selectedTimeSlotIds.size) return false;
    for (const id of draftSelection) {
      if (!selectedTimeSlotIds.has(id)) return false;
    }
    return true;
  }, [draftSelection, selectedTimeSlotIds]);
  
  // Check if a time slot is selected in current draft
  const isTimeSlotSelected = useCallback((slotId: string) => {
    return draftSelection.has(slotId);
  }, [draftSelection]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm" onClick={onClose}>
      <div 
        className="bg-gray-900 rounded-xl w-[1100px] max-h-[85vh] shadow-2xl border border-gray-700 overflow-hidden flex"
        onClick={e => e.stopPropagation()}
      >
        {/* Left: Calendar + Filters */}
        <div className="w-[360px] flex flex-col border-r border-gray-700">
          {/* Calendar Section */}
          <div className="p-5 flex-shrink-0">
            <div className="flex items-center justify-between mb-2">
              <button
                onClick={goToEarliestMonth}
                disabled={isAtEarliest}
                className={`p-1 rounded transition-colors ${
                  isAtEarliest 
                    ? 'text-gray-700 cursor-not-allowed' 
                    : 'text-gray-500 hover:text-gray-300 hover:bg-gray-800'
                }`}
                title="Jump to earliest"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
                </svg>
              </button>
              
              <button
                onClick={goToPreviousMonth}
                disabled={isAtEarliest}
                className={`p-1 rounded transition-colors ${
                  isAtEarliest 
                    ? 'text-gray-700 cursor-not-allowed' 
                    : 'text-gray-400 hover:bg-gray-800'
                }`}
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </button>
              
              <h3 className="text-lg font-semibold text-white">
                {monthNames[currentMonth.month]} {currentMonth.year}
              </h3>
              
              <button
                onClick={goToNextMonth}
                disabled={isAtLatest}
                className={`p-1 rounded transition-colors ${
                  isAtLatest 
                    ? 'text-gray-700 cursor-not-allowed' 
                    : 'text-gray-400 hover:bg-gray-800'
                }`}
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </button>
              
              <button
                onClick={goToLatestMonth}
                disabled={isAtLatest}
                className={`p-1 rounded transition-colors ${
                  isAtLatest 
                    ? 'text-gray-700 cursor-not-allowed' 
                    : 'text-gray-500 hover:text-gray-300 hover:bg-gray-800'
                }`}
                title="Jump to latest"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 5l7 7-7 7M5 5l7 7-7 7" />
                </svg>
              </button>
            </div>

            <div className="grid grid-cols-7 gap-1 mb-2">
              {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => (
                <div key={day} className="text-center text-xs text-gray-500 py-1">
                  {day}
                </div>
              ))}
            </div>

            <div className="grid grid-cols-7 gap-1">
              {calendarDays.map((dayInfo, idx) => {
                const hasVideos = dayInfo.sources.length > 0;
                return (
                  <button
                    key={idx}
                    disabled={!hasVideos}
                    onClick={() => hasVideos && setSelectedDate(dayInfo.dateStr)}
                    className={`
                      aspect-square rounded-lg text-sm font-medium transition-all relative
                      ${!dayInfo.day ? 'invisible' : ''}
                      ${hasVideos 
                        ? 'bg-blue-600/20 text-blue-400 hover:bg-blue-600/30 cursor-pointer' 
                        : 'text-gray-600 cursor-default'}
                      ${selectedDate === dayInfo.dateStr ? 'ring-2 ring-blue-500 bg-blue-600/40' : ''}
                    `}
                  >
                    {dayInfo.day}
                    {hasVideos && (
                      <div className="absolute bottom-1 left-1/2 -translate-x-1/2 flex gap-0.5">
                        {dayInfo.sources.slice(0, 3).map((source, i) => {
                          const bgColor = SOURCE_COLORS[source].split(' ')[0].replace('/20', '');
                          return (
                            <div 
                              key={source} 
                              className={`w-1.5 h-1.5 rounded-full ${bgColor}`} 
                            />
                          );
                        })}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Filter Section */}
          <div className="flex-1 min-h-0 overflow-y-auto border-t border-gray-700 p-5">
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-sm font-medium text-white">Filter by Source</h4>
              <div className="flex gap-2">
                <button
                  onClick={selectAllSources}
                  className="text-xs text-blue-400 hover:text-blue-300 px-2 py-1 rounded hover:bg-blue-600/10"
                >
                  All
                </button>
                <button
                  onClick={clearAllSources}
                  className="text-xs text-gray-500 hover:text-gray-400 px-2 py-1 rounded hover:bg-gray-800"
                >
                  None
                </button>
              </div>
            </div>

            <div className="space-y-1.5">
              {ALL_SOURCES.map(source => {
                const count = sourceStats.get(source) || 0;
                const isSelected = selectedSources.has(source);
                const isDisabled = count === 0;
                const colorClass = SOURCE_COLORS[source];
                const bgColor = colorClass.split(' ')[0];
                const textColor = colorClass.split(' ')[1];
                
                return (
                  <button
                    key={source}
                    disabled={isDisabled}
                    onClick={() => toggleSource(source)}
                    className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg transition-all ${
                      isDisabled 
                        ? 'opacity-30 cursor-not-allowed' 
                        : isSelected
                          ? 'bg-gray-800 hover:bg-gray-750'
                          : 'hover:bg-gray-800/50'
                    }`}
                  >
                    <div className={`w-5 h-5 rounded-md border-2 flex items-center justify-center transition-all ${
                      isSelected 
                        ? `${bgColor} border-transparent` 
                        : 'border-gray-600 bg-gray-900'
                    }`}>
                      {isSelected && (
                        <svg className={`w-3.5 h-3.5 ${textColor}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                    </div>
                    
                    <span className={`w-2 h-2 rounded-full ${bgColor.replace('/20', '')}`} />
                    
                    <span className={`flex-1 text-sm ${isSelected ? 'text-white' : 'text-gray-400'}`}>
                      {SOURCE_LABELS[source]}
                    </span>
                    
                    <span className={`text-xs tabular-nums ${isSelected ? 'text-gray-400' : 'text-gray-600'}`}>
                      {count}
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="mt-4 pt-4 border-t border-gray-800">
              <div className="flex items-center justify-between text-xs">
                <span className="text-gray-500">Total recordings</span>
                <span className="text-white font-medium">{totalRecordings}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Right: Time list */}
        <div className="flex-1 flex flex-col min-h-0">
          {/* Header with selection controls */}
          <div className="p-4 border-b border-gray-700 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <h3 className="font-semibold text-white">
                {selectedDateEntry ? selectedDateEntry.displayDate : 'Select a date'}
              </h3>
              {selectedDateEntry && (
                <span className="text-xs text-gray-400">
                  {selectedDateEntry.timeSlots.length} recordings
                </span>
              )}
            </div>
            
            {selectedDateEntry && timeSlotsWithIndex.length > 0 && (
              <div className="flex items-center gap-2">
                <button
                  onClick={selectAllTimeSlots}
                  className="text-xs text-blue-400 hover:text-blue-300 px-2 py-1 rounded hover:bg-blue-600/10"
                >
                  Select All
                </button>
                <button
                  onClick={clearAllTimeSlots}
                  className="text-xs text-gray-500 hover:text-gray-400 px-2 py-1 rounded hover:bg-gray-800"
                >
                  Clear Selected
                </button>
              </div>
            )}
          </div>

          {/* Time slots list */}
          <div className="flex-1 overflow-y-auto p-4">
            {selectedDateEntry ? (
              <div className="space-y-2 select-none">
                {timeSlotsWithIndex.map((timeSlot, idx) => {
                  const allCameras = hasAllCameras(timeSlot);
                  const cameraCount = getCameraCount(timeSlot);
                  const isSelected = isTimeSlotSelected(timeSlot.id);
                  
                  return (
                    <div
                      key={timeSlot.id}
                      ref={el => {
                        if (el) timeSlotRefs.current.set(timeSlot.id, el);
                      }}
                      onClick={(e) => handleRowClick(timeSlot.id, idx, e)}
                      onDoubleClick={() => handleDoubleClick(timeSlot.id, idx)}
                      onMouseDown={(e) => handleRowMouseDown(timeSlot.id, idx, e)}
                      onMouseEnter={() => handleRowMouseEnter(timeSlot.id, idx)}
                      onMouseUp={handleMouseUp}
                      className={`
                        group w-full p-3 rounded-lg text-left transition-all border cursor-pointer
                        ${isSelected 
                          ? 'bg-green-600/20 border-green-500/50 ring-1 ring-green-500/30' 
                          : 'bg-gray-800 border-gray-700 hover:border-gray-600'}
                      `}
                    >
                      <div className="flex items-center justify-between">
                        {/* Left: Checkbox + Info */}
                        <div className="flex items-center gap-3">
                          {/* Circular Checkbox - visible on hover or when selected */}
                          <div 
                            className={`
                              w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all flex-shrink-0
                              ${isSelected 
                                ? 'bg-green-500 border-green-500 opacity-100' 
                                : 'border-gray-500 bg-gray-900/50 opacity-0 group-hover:opacity-100'}
                            `}
                          >
                            {isSelected && (
                              <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                              </svg>
                            )}
                          </div>
                          
                          {/* Play icon */}
                          <div className={`w-10 h-10 rounded flex items-center justify-center transition-colors ${
                            isSelected 
                              ? 'bg-green-600/30' 
                              : 'bg-gray-700'
                          }`}>
                            <svg className={`w-5 h-5 ${isSelected ? 'text-green-400' : 'text-gray-400'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                          </div>
                          
                          <div>
                            <div className="text-sm font-medium text-white">
                              {timeSlot.displayTime}
                            </div>
                            <div className="text-xs text-gray-500">
                              {allCameras ? 'All 6 cameras' : `${cameraCount} camera${cameraCount > 1 ? 's' : ''}`}
                              {(timeSlot.city || timeSlot.street) && (
                                <span className="ml-2 text-gray-400">
                                  {timeSlot.city}{timeSlot.city && timeSlot.street ? ' · ' : ''}{timeSlot.street}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                        
                        {/* Right: Badges */}
                        <div className="flex items-center gap-1.5 flex-wrap justify-end">
                          {timeSlot.hasGps && (
                            <span className="px-2 py-0.5 bg-cyan-600/20 text-cyan-400 text-[10px] rounded flex items-center gap-1">
                              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                              </svg>
                              GPS
                            </span>
                          )}
                          {timeSlot.eventReason && (
                            <span className="px-2 py-0.5 bg-amber-600/20 text-amber-400 text-[10px] rounded">
                              {timeSlot.eventReason}
                            </span>
                          )}
                          {timeSlot.sources.map((source) => (
                            <span
                              key={source}
                              className={`px-2 py-0.5 text-[10px] rounded ${SOURCE_COLORS[source]}`}
                            >
                              {SOURCE_LABELS[source]}
                            </span>
                          ))}
                          {allCameras && (
                            <span className={`px-2 py-0.5 text-[10px] rounded ${COMPLETE_BADGE_COLOR}`}>
                              Complete
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="h-full flex items-center justify-center text-gray-500">
                <div className="text-center">
                  <svg className="w-12 h-12 mx-auto mb-3 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                  <p className="text-sm">Select a date from the calendar</p>
                  <p className="text-xs text-gray-600 mt-1">Use filters to narrow down recordings</p>
                </div>
              </div>
            )}
          </div>
          
          {/* Bottom action bar - always visible */}
          <div className="p-4 border-t border-gray-700 bg-gray-800/50">
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-400">
                {selectedCount > 0 
                  ? `${selectedCount} item${selectedCount > 1 ? 's' : ''} selected` 
                  : 'No items selected'}
              </span>
              <div className="flex items-center gap-3">
                <button
                  onClick={discardSelections}
                  className="px-4 py-2 text-sm text-red-400 hover:text-red-300 transition-colors flex items-center gap-2"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                  Discard
                </button>
                <button
                  onClick={handleImport}
                  disabled={selectedCount === 0 || isSelectionUnchanged}
                  className={`px-6 py-2 text-white text-sm font-medium rounded-lg transition-colors ${
                    isSelectionUnchanged && hasImportedSelections
                      ? 'bg-green-600 cursor-default'
                      : 'bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 disabled:text-gray-500 disabled:cursor-not-allowed'
                  }`}
                >
                  {isSelectionUnchanged && hasImportedSelections
                    ? 'Imported' 
                    : `Import ${selectedCount > 1 ? `(${selectedCount})` : ''}`}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
