import { app, BrowserWindow, screen, ipcMain } from "electron";

import * as path from "node:path";
import { type Action, ComputerTool } from "./computer";

const computerTool = new ComputerTool();
function createWindow() {
	const mainWindow = new BrowserWindow({
		width: 300,
		height: 200,
		alwaysOnTop: true,
		frame: false,
		resizable: false,
		transparent: true,
		hasShadow: true,
		titleBarStyle: "default",
		webPreferences: {
			contextIsolation: true,
			nodeIntegration: true,
			preload: path.join(__dirname, "preload.js"),
		},
	});

	const display = screen.getPrimaryDisplay();

	const { width } = display.workAreaSize;

	mainWindow.loadFile(path.join(__dirname, "../index.html"));
	const windowWidth = 300;
	const windowHeight = 200;
	const x = width - windowWidth;
	const y = 0;
	mainWindow.setBounds({ x, y, width: windowWidth, height: windowHeight });
	mainWindow.webContents.openDevTools();
}
app.whenReady().then(() => {
	createWindow();

	app.on("activate", () => {
		if (BrowserWindow.getAllWindows().length === 0) createWindow();
	});
});

app.on("window-all-closed", () => {
	if (process.platform !== "darwin") {
		app.quit();
	}
});

ipcMain.on(
	"computer-tool",
	async (
		event,
		{
			action,
			text,
			coordinate,
		}: {
			action: Action;
			text?: string | null;
			coordinate?: number[] | null;
		},
	) => {
		console.log("computer-tool event received", action, text, coordinate);
		computerTool.call({ action, text, coordinate });

		return true;
	},
);
