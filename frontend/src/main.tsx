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
