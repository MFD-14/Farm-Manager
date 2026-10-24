import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import "./styles.css";
import { registerSW } from "virtual:pwa-register";

// The native shells ship the web bundle on the device, so a service worker
// would only add a second, stale cache. Browsers and installed PWAs need it.
if (!window.Capacitor?.isNativePlatform?.()) {
  registerSW({ immediate: true });
}
createRoot(document.getElementById("root")).render(<App />);
