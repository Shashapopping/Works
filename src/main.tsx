import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import "./styles/home-dashboard.css";
import "./styles/core-pages.css";
import "./styles/page-period.css";
import "./styles/page-period-chips.css";
import App from "./App.tsx";
import { DEMO_BRANDING, DEMO } from "./config/demoBranding";

document.title = DEMO_BRANDING ? DEMO.productName : "HBM Fleet Intelligence — BPL";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
  