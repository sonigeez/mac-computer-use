const { contextBridge, ipcRenderer } = require("electron");
import type { Action } from "./computer";

console.log("preload.js");
contextBridge.exposeInMainWorld("api", {
	computerTool: async (
		action: Action,
		text?: string,
		coordinate?: number[],
	) => {
		console.log("computerTool getting called", action, text, coordinate);
		ipcRenderer.send("computer-tool", { action, text, coordinate });
		return "Task Done";
	},
});
