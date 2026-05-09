import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './shared/style/index.css'
import App from './App.tsx'
import "./shared/style/Global.css";
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)