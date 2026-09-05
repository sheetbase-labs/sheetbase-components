import React from 'react'
import ReactDOM from 'react-dom/client'
import { App } from './App'
import 'sheetbase-shared/theme.css'
import './styles.css'
import './ux-overrides.css'
import './explorer-v2.css'
import './explorer-v3.css'
import './explorer-interactions.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
