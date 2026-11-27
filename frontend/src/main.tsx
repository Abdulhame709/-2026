import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import '@fontsource/ibm-plex-sans-arabic/400.css';
import '@fontsource/ibm-plex-sans-arabic/500.css';
import '@fontsource/ibm-plex-sans-arabic/600.css';
import '@fontsource/ibm-plex-sans-arabic/700.css';
import './index.css';
import { AppProviders } from './app/providers';

ReactDOM.createRoot(document.getElementById('root')!).render(
  // ملاحظة: StrictMode مؤقتاً معطّل لتوافق انتقالات React Router في وضع التطوير
  <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
    <AppProviders />
  </BrowserRouter>,
);

// تسجيل عامل الخدمة في نسخة البناء فقط (PWA). التطوير يبقى بلا تخزين مؤقت
// حتى لا تظهر نسخ قديمة أثناء العمل، ولا يقع التسجيل إلا على أصل آمن (HTTPS أو localhost).
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => undefined);
  });
}
