import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import { ThemeProvider } from "@/app/theme-provider";
import { AuthProvider } from "@/app/auth-provider";
import { OrganizationProvider } from "@/app/organization-provider";
import App from "@/app/App";
import "@/index.css";

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <ThemeProvider>
      <BrowserRouter><AuthProvider><OrganizationProvider><App /></OrganizationProvider></AuthProvider></BrowserRouter>
    </ThemeProvider>
  </React.StrictMode>,
);
