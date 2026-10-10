import type { Metadata, Viewport } from 'next';
import 'leaflet/dist/leaflet.css';
import './globals.css';
export const metadata: Metadata = {
  title: 'يورست للصناعات | إدارة علاقات العملاء',
  description: 'المصانع وفرص بيع قوالب الطابوق والزيارات وعروض الأسعار في يورست للصناعات',
  applicationName: 'Yourrest CRM',
  manifest: '/manifest.webmanifest',
  icons: {
    icon: [{ url: '/yourrest-company-icon.svg', type: 'image/svg+xml' }, { url: '/icons/yourrest-company-192.png', sizes: '192x192', type: 'image/png' }],
    shortcut: '/yourrest-company-icon.svg',
    apple: [{ url: '/icons/yourrest-company-apple.png', sizes: '180x180', type: 'image/png' }],
  },
  appleWebApp: { capable: true, title: 'Yourrest CRM', statusBarStyle: 'default' },
  other: { 'apple-mobile-web-app-capable': 'yes' },
};
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  interactiveWidget: 'resizes-content',
  themeColor: '#166344',
};
export default function Layout({children}:{children:React.ReactNode}){return <html lang="ar" dir="rtl"><head><script src="/theme-bootstrap.js"/><script src="/install-bootstrap.js"/></head><body>{children}</body></html>;}
