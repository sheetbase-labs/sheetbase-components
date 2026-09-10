import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import "sheetbase-shared/theme.css";
import "sheetbase-shared/shell.css";
import "sheetbase-shared/panes.css";
import "./demo.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
