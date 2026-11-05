import './styles.css';
import { App } from './app/app.ts';
import { menuScreen } from './ui/screens/menu.ts';

const app = new App();
app.show(menuScreen(app));
(window as any).__app = app;

if ('serviceWorker' in navigator && !location.hostname.includes('localhost') && location.protocol === 'https:') {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => undefined);
  });
}
