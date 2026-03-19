'use client';

import { useLanguage } from '@/lib/i18n';
import { IconLanguage } from '@tabler/icons-react';

export function LanguageSwitcher() {
  const { language, setLanguage } = useLanguage();

  const toggleLanguage = () => {
    setLanguage(language === 'en' ? 'zh' : 'en');
  };

  return (
    <button
      onClick={toggleLanguage}
      className="fixed bottom-4 right-4 z-[9999] flex items-center gap-2 px-3 py-2 rounded-full shadow-lg transition-all duration-200 bg-gray-800/90 text-gray-300 hover:bg-gray-700/90 backdrop-blur-sm hover:scale-105 active:scale-95"
      title={language === 'en' ? '切换到中文' : 'Switch to English'}
    >
      <IconLanguage size={18} />
      <span className="text-sm font-medium">
        {language === 'en' ? 'EN' : '中文'}
      </span>
    </button>
  );
}
