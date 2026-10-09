import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@sheetbase-labs/sheetbase-shared/theme.css";
import { App } from "./ui/App";
import "./ui/styles.css";

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("missing #root element");
createRoot(rootElement).render(
  <StrictMode><App /></StrictMode>,
);
