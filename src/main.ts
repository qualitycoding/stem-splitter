import { App } from "./ui";
import "./style.css";

const root = document.getElementById("app");
if (!root) throw new Error("main.ts: #app mount point not found in index.html");

new App(root);
