'use client';

import { useState, useMemo } from 'react';
import { DateEntry, TimeSlot, hasAllCameras, getCameraCount } from '@/types/folder';

interface VideoBrowserProps {
  folderStructure: {
    dates: DateEntry[];
  };
  onSelectTimeSlot: (timeSlot: TimeSlot) => void;
  onClose: () => void;
}

export function VideoBrowser({ folderStructure, onSelectTimeSlot, onClose }: VideoBrowserProps) {
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  
  // Find earliest date with videos
  const earliestDate = useMemo(() => {
    if (folderStructure.dates.length === 0) return null;
    return folderStructure.dates[0].date; // Dates are already sorted
  }, [folderStructure.dates]);
  
  // Parse earliest date for initial month
  const initialMonth = useMemo(() => {
    if (earliestDate) {
      const [year, month] = earliestDate.split('-').map(Number);
      return { year, month: month - 1 }; // month is 0-indexed in JS Date
    }
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() };
  }, [earliestDate]);
  
  const [currentMonth, setCurrentMonth] = useState(initialMonth);

  // Get selected date entry
  const selectedDateEntry = useMemo(() => {
    if (!selectedDate) return null;
    return folderStructure.dates.find(d => d.date === selectedDate) || null;
  }, [selectedDate, folderStructure.dates]);

  // Parse dates with available videos
  const datesWithVideos = useMemo(() => {
    return new Set(folderStructure.dates.map(d => d.date));
  }, [folderStructure.dates]);

  // Generate calendar days
  const calendarDays = useMemo(() => {
    const { year, month } = currentMonth;
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const startPadding = firstDay.getDay(); // 0 = Sunday
    const daysInMonth = lastDay.getDate();
    
    const days: { day: number; dateStr: string; hasVideos: boolean }[] = [];
    
    // Padding days
    for (let i = 0; i < startPadding; i++) {
      days.push({ day: 0, dateStr: '', hasVideos: false });
    }
    
    // Actual days
    for (let day = 1; day <= daysInMonth; day++) {
      const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      days.push({
        day,
        dateStr,
        hasVideos: datesWithVideos.has(dateStr),
      });
    }
    
    return days;
  }, [currentMonth, datesWithVideos]);

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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm" onClick={onClose}>
      <div 
        className="bg-gray-900 rounded-xl w-[900px] max-h-[80vh] shadow-2xl border border-gray-700 overflow-hidden flex"
        onClick={e => e.stopPropagation()}
      >
        {/* Left: Calendar */}
        <div className="w-[400px] p-6 border-r border-gray-700">
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

          {/* Jump to earliest date button */}
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

          {/* Weekday headers */}
          <div className="grid grid-cols-7 gap-1 mb-2">
            {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => (
              <div key={day} className="text-center text-xs text-gray-500 py-1">
                {day}
              </div>
            ))}
          </div>

          {/* Calendar grid */}
          <div className="grid grid-cols-7 gap-1">
            {calendarDays.map((dayInfo, idx) => (
              <button
                key={idx}
                disabled={!dayInfo.hasVideos}
                onClick={() => dayInfo.hasVideos && setSelectedDate(dayInfo.dateStr)}
                className={`
                  aspect-square rounded-lg text-sm font-medium transition-all relative
                  ${!dayInfo.day ? 'invisible' : ''}
                  ${dayInfo.hasVideos 
                    ? 'bg-blue-600/20 text-blue-400 hover:bg-blue-600/30 cursor-pointer' 
                    : 'text-gray-600 cursor-default'}
                  ${selectedDate === dayInfo.dateStr ? 'ring-2 ring-blue-500 bg-blue-600/40' : ''}
                `}
              >
                {dayInfo.day}
                {dayInfo.hasVideos && (
                  <div className="absolute bottom-1 left-1/2 -translate-x-1/2 w-1 h-1 bg-blue-400 rounded-full" />
                )}
              </button>
            ))}
          </div>

          <div className="mt-4 text-xs text-gray-500">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 bg-blue-600/20 rounded-full" />
              <span>Has recordings</span>
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
                        <div className="flex items-center gap-1">
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
                  <p className="text-xs text-gray-600 mt-1">Dates with recordings are highlighted</p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
