import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import "@sheetbase-labs/sheetbase-shared/theme.css";
import "@sheetbase-labs/sheetbase-shared/shell.css";
import "./styles.css";
import "./demo.css";

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("missing #root element");
ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
