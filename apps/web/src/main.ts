import { mount } from "svelte";
import App from "./App.svelte";
import "./app.css";

// Thème appliqué avant le rendu pour éviter tout flash (sombre par défaut).
const savedTheme = localStorage.getItem("gp-theme");
document.documentElement.dataset.theme = savedTheme === "light" ? "light" : "dark";

const app = mount(App, {
  target: document.getElementById("app")!,
});

export default app;
