import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import { ThemeProvider } from "@/app/theme-provider";
import { AuthProvider } from "@/app/auth-provider";
import { OrganizationProvider } from "@/app/organization-provider";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/backend/query-cache";
import App from "@/app/App";
import "@/index.css";

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <BrowserRouter><AuthProvider><OrganizationProvider><App /></OrganizationProvider></AuthProvider></BrowserRouter>
      </ThemeProvider>
    </QueryClientProvider>
  </React.StrictMode>,
);
