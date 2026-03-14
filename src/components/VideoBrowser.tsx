'use client';

import { useState, useMemo } from 'react';
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
  onSelectTimeSlot: (timeSlot: TimeSlot) => void;
  onClose: () => void;
}

const ALL_SOURCES: VideoSource[] = ['recent', 'saved', 'sentry', 'encrypted', 'photobooth', 'unknown'];

export function VideoBrowser({ folderStructure, onSelectTimeSlot, onClose }: VideoBrowserProps) {
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [selectedSources, setSelectedSources] = useState<Set<VideoSource>>(new Set(ALL_SOURCES));
  
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
  
  // Find earliest date with videos (from filtered)
  const earliestDate = useMemo(() => {
    if (filteredDates.length === 0) return null;
    return filteredDates[0].date;
  }, [filteredDates]);
  
  // Parse earliest date for initial month
  const initialMonth = useMemo(() => {
    if (earliestDate) {
      const [year, month] = earliestDate.split('-').map(Number);
      return { year, month: month - 1 };
    }
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() };
  }, [earliestDate]);
  
  const [currentMonth, setCurrentMonth] = useState(initialMonth);

  // Get selected date entry (from filtered)
  const selectedDateEntry = useMemo(() => {
    if (!selectedDate) return null;
    return filteredDates.find(d => d.date === selectedDate) || null;
  }, [selectedDate, filteredDates]);

  // Parse dates with available videos and their source types (filtered)
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

  const goToPreviousMonth = () => {
    setCurrentMonth(prev => {
      if (prev.month === 0) {
        return { year: prev.year - 1, month: 11 };
      }
      return { ...prev, month: prev.month - 1 };
    });
  };

  const goToNextMonth = () => {
    setCurrentMonth(prev => {
      if (prev.month === 11) {
        return { year: prev.year + 1, month: 0 };
      }
      return { ...prev, month: prev.month + 1 };
    });
  };

  const jumpToEarliestDate = () => {
    if (earliestDate) {
      const [year, month] = earliestDate.split('-').map(Number);
      setCurrentMonth({ year, month: month - 1 });
      setSelectedDate(earliestDate);
    }
  };

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
    // Clear selected date if it's no longer in filtered results
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

  // Calculate total recordings after filter
  const totalRecordings = useMemo(() => {
    return filteredDates.reduce((sum, d) => sum + d.timeSlots.length, 0);
  }, [filteredDates]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm" onClick={onClose}>
      <div 
        className="bg-gray-900 rounded-xl w-[1000px] max-h-[85vh] shadow-2xl border border-gray-700 overflow-hidden flex"
        onClick={e => e.stopPropagation()}
      >
        {/* Left: Calendar + Filters */}
        <div className="w-[360px] flex flex-col border-r border-gray-700">
          {/* Calendar Section */}
          <div className="p-5 flex-shrink-0">
            <div className="flex items-center justify-between mb-2">
              <button
                onClick={goToPreviousMonth}
                className="p-1 rounded hover:bg-gray-800 text-gray-400"
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
                className="p-1 rounded hover:bg-gray-800 text-gray-400"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </button>
            </div>

            {earliestDate && (
              <div className="flex justify-center mb-3">
                <button
                  onClick={jumpToEarliestDate}
                  className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1 px-2 py-1 rounded hover:bg-blue-600/10 transition-colors"
                >
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
                  </svg>
                  Jump to earliest ({earliestDate})
                </button>
              </div>
            )}

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
                    {/* Custom checkbox */}
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
                    
                    {/* Source indicator dot */}
                    <span className={`w-2 h-2 rounded-full ${bgColor.replace('/20', '')}`} />
                    
                    {/* Label */}
                    <span className={`flex-1 text-sm ${isSelected ? 'text-white' : 'text-gray-400'}`}>
                      {SOURCE_LABELS[source]}
                    </span>
                    
                    {/* Count */}
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
          <div className="p-4 border-b border-gray-700 flex items-center justify-between">
            <h3 className="font-semibold text-white">
              {selectedDateEntry ? selectedDateEntry.displayDate : 'Select a date'}
            </h3>
            {selectedDateEntry && (
              <span className="text-xs text-gray-400">
                {selectedDateEntry.timeSlots.length} recordings
              </span>
            )}
          </div>

          <div className="flex-1 overflow-y-auto p-4">
            {selectedDateEntry ? (
              <div className="space-y-2">
                {selectedDateEntry.timeSlots.map((timeSlot, idx) => {
                  const allCameras = hasAllCameras(timeSlot);
                  const cameraCount = getCameraCount(timeSlot);
                  
                  return (
                    <button
                      key={idx}
                      onClick={() => onSelectTimeSlot(timeSlot)}
                      className="w-full p-3 bg-gray-800 hover:bg-gray-750 rounded-lg text-left transition-colors border border-gray-700 hover:border-gray-600 group"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded bg-gray-700 flex items-center justify-center">
                            <svg className="w-5 h-5 text-gray-400 group-hover:text-blue-400 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                          </div>
                          <div>
                            <div className="text-sm font-medium text-white">
                              {timeSlot.displayTime}
                            </div>
                            <div className="text-xs text-gray-500">
                              {allCameras ? 'All 6 cameras' : `${cameraCount} camera${cameraCount > 1 ? 's' : ''}`}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5 flex-wrap justify-end">
                          {timeSlot.sources.map((source) => (
                            <span
                              key={source}
                              className={`px-2 py-0.5 text-[10px] rounded ${SOURCE_COLORS[source]}`}
                            >
                              {SOURCE_LABELS[source]}
                            </span>
                          ))}
                          {timeSlot.hasGps && (
                            <span className="px-2 py-0.5 bg-cyan-600/20 text-cyan-400 text-[10px] rounded flex items-center gap-1">
                              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                              </svg>
                              GPS
                            </span>
                          )}
                          {allCameras && (
                            <span className="px-2 py-0.5 bg-green-600/20 text-green-400 text-[10px] rounded">
                              Complete
                            </span>
                          )}
                          <svg className="w-4 h-4 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                          </svg>
                        </div>
                      </div>
                    </button>
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
        </div>
      </div>
    </div>
  );
}
