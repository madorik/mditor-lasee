import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "../promo";
import { App } from "./App";
import "./editor.css";

const client = new QueryClient({ defaultOptions: { queries: { refetchOnWindowFocus: false, refetchOnReconnect: false } } });

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={client}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);
