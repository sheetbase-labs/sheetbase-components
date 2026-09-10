import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "sheetbase-shared/theme.css";
import { App } from "./ui/App";
import "./ui/styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode><App /></StrictMode>,
);
