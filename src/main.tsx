import { createRoot } from 'react-dom/client';
import App from './App';
import './lite.css';
import { recent } from './credentials';
recent();
createRoot(document.getElementById('root')!).render(<App />);
