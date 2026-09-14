import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { TripPlannerScreen } from "./trip/TripPlannerScreen";
import "./styles.css";

const isPlannerRoute = (hash: string) => hash.startsWith("#/plan");

function Root() {
  const [route, setRoute] = useState(() =>
    isPlannerRoute(window.location.hash),
  );
  useEffect(() => {
    const onHashChange = () => setRoute(isPlannerRoute(window.location.hash));
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);
  return route ? <TripPlannerScreen /> : <App />;
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
);

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => undefined);
  });
}
