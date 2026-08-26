import { createRoot } from "react-dom/client";
import { CRMApp } from "./app/CRMApp";
import "../app/globals.css";

const root = document.getElementById("root");

if (!root) {
  throw new Error("CRM root element was not found.");
}

createRoot(root).render(<CRMApp />);
