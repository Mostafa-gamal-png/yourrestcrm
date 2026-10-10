'use client';

import {useEffect, useState} from 'react';
import {Moon, Sun} from 'lucide-react';
import {useLanguage} from '@/lib/i18n';
import {applyTheme, readTheme, saveTheme} from '@/lib/theme';
import './theme-toggle.css';

export default function ThemeToggle() {
  const {language} = useLanguage();
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const refresh = () => {
      const theme = readTheme();
      applyTheme(theme);
      setDark(theme === 'dark');
    };
    refresh();
    const storage = (event: StorageEvent) => {
      if (event.key === 'yr-theme' || event.key === null) refresh();
    };
    window.addEventListener('storage', storage);
    return () => window.removeEventListener('storage', storage);
  }, []);

  const label = language === 'ar' ? 'الوضع الليلي' : 'Dark mode';
  return <span className="theme-toggle">
    <button type="button" role="switch" className="theme-toggle-control" aria-checked={dark} aria-label={label} title={label} onClick={() => {
      // The document is the latest source even if two native clicks share a render.
      const nextDark = !document.documentElement.classList.contains('dark');
      saveTheme(nextDark ? 'dark' : 'light');
      setDark(nextDark);
    }}>
      <span className="theme-toggle-track" aria-hidden="true"/>
      <span className="theme-toggle-thumb" aria-hidden="true">{dark ? <Moon size={15}/> : <Sun size={16}/>}</span>
    </button>
    <span className="theme-toggle-caption" aria-hidden="true">{language === 'ar' ? (dark ? 'ليلي' : 'نهاري') : (dark ? 'Dark' : 'Light')}</span>
  </span>;
}
