import React from 'react'
import ReactDOM from 'react-dom/client'
import '@fontsource-variable/inter'
import '@fontsource-variable/jetbrains-mono'
import '@sheetbase-labs/sheetbase-shared/theme.css'
import '@sheetbase-labs/sheetbase-shared/shell.css'
import './ui/studio.css'
import './demo/demo.css'
import { DemoApp } from './demo/DemoApp'

const rootElement = document.getElementById('root')
if (!rootElement) throw new Error('missing #root element')
ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <DemoApp />
  </React.StrictMode>,
)
