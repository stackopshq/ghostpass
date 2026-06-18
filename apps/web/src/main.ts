import { mount } from "svelte";
import App from "./App.svelte";
import SendView from "./SendView.svelte";
import "./app.css";

// Thème appliqué avant le rendu pour éviter tout flash (sombre par défaut).
const savedTheme = localStorage.getItem("gp-theme");
document.documentElement.dataset.theme = savedTheme === "light" ? "light" : "dark";

// Routage minimal : /s/:id = page publique de consultation d'un lien partagé.
const target = document.getElementById("app")!;
const app = location.pathname.startsWith("/s/")
  ? mount(SendView, { target })
  : mount(App, { target });

export default app;
