import './styles.css';

// Web fonts are added once the page has loaded, so nothing waits on them (text shows in the
// fallback condensed face until they arrive; the stylesheet uses font-display: swap).
const FONTS = 'https://fonts.googleapis.com/css2?family=Barlow+Condensed:ital,wght@0,500;0,700;0,800;0,900;1,700;1,800;1,900&family=Barlow:wght@400;600;700&display=swap';
const addFonts = () => {
  const l = document.createElement('link');
  l.rel = 'stylesheet';
  l.href = FONTS;
  document.head.append(l);
};
if (document.readyState === 'complete') addFonts();
else window.addEventListener('load', addFonts, { once: true });
import { App } from './app/app.ts';
import { menuScreen } from './ui/screens/menu.ts';

const app = new App();
app.show(menuScreen(app));
(window as any).__app = app;
if (new URLSearchParams(location.search).has('uitest')) void import('./ui/uitest.ts').then((m) => m.installUiTest(app));

if ('serviceWorker' in navigator && !location.hostname.includes('localhost') && location.protocol === 'https:') {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => undefined);
  });
}
