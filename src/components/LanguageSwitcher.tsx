'use client';

import { useState, useRef, useEffect } from 'react';
import { useLanguage } from '@/lib/i18n';
import { IconLanguage } from '@tabler/icons-react';

export function LanguageSwitcher() {
  const { language, setLanguage } = useLanguage();
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const toggleLanguage = (lang: 'en' | 'zh') => {
    setLanguage(lang);
    setIsOpen(false);
  };

  return (
    <div 
      ref={containerRef}
      className="fixed bottom-4 right-4 z-[9999]"
    >
      {/* Main button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`flex items-center gap-2 px-3 py-2 rounded-full shadow-lg transition-all duration-200 ${
          isOpen 
            ? 'bg-blue-600 text-white' 
            : 'bg-gray-800/90 text-gray-300 hover:bg-gray-700/90 backdrop-blur-sm'
        }`}
        title="Switch Language / 切换语言"
      >
        <IconLanguage size={18} />
        <span className="text-sm font-medium">
          {language === 'en' ? 'EN' : '中文'}
        </span>
      </button>

      {/* Dropdown menu */}
      {isOpen && (
        <div className="absolute bottom-full right-0 mb-2 bg-gray-800/95 backdrop-blur-sm rounded-xl shadow-xl border border-gray-700 overflow-hidden min-w-[140px]">
          <button
            onClick={() => toggleLanguage('en')}
            className={`w-full px-4 py-3 text-left text-sm flex items-center gap-3 transition-colors ${
              language === 'en'
                ? 'bg-blue-600/30 text-blue-300'
                : 'text-gray-300 hover:bg-gray-700/50'
            }`}
          >
            <span className={`w-2 h-2 rounded-full ${language === 'en' ? 'bg-blue-400' : 'bg-gray-600'}`} />
            English
          </button>
          <button
            onClick={() => toggleLanguage('zh')}
            className={`w-full px-4 py-3 text-left text-sm flex items-center gap-3 transition-colors ${
              language === 'zh'
                ? 'bg-blue-600/30 text-blue-300'
                : 'text-gray-300 hover:bg-gray-700/50'
            }`}
          >
            <span className={`w-2 h-2 rounded-full ${language === 'zh' ? 'bg-blue-400' : 'bg-gray-600'}`} />
            中文
          </button>
        </div>
      )}
    </div>
  );
}
