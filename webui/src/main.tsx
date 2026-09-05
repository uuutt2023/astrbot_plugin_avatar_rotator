import React from "react";
import { createRoot } from "react-dom/client";
import { AppRoot } from "./App";
import "./styles.css";

const container = document.getElementById("root");
if (!container) throw new Error("#root not found");
container.innerHTML = "";
createRoot(container).render(<AppRoot />);
