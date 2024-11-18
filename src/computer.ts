import { exec } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const OUTPUT_DIR = join(tmpdir(), "outputs");

type Action =
	| "key"
	| "type"
	| "mouse_move"
	| "left_click"
	| "left_click_drag"
	| "right_click"
	| "middle_click"
	| "double_click"
	| "screenshot"
	| "cursor_position";

type ScalingTarget = {
	width: number;
	height: number;
};

const MAX_SCALING_TARGETS: Record<string, ScalingTarget> = {
	XGA: { width: 1024, height: 768 },
	WXGA: { width: 1280, height: 800 },
	FWXGA: { width: 1366, height: 768 },
};

class ToolError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "ToolError";
	}
}

interface ToolResultProps {
	output?: string;
	error?: string;
	base64Image?: string | null;
}

class ToolResult {
	output: string;
	error: string;
	base64Image: string | null;

	constructor({
		output = "",
		error = "",
		base64Image = null,
	}: ToolResultProps) {
		this.output = output;
		this.error = error;
		this.base64Image = base64Image;
	}

	replace({
		output = null,
		error = null,
		base64Image = null,
	}: ToolResultProps): ToolResult {
		return new ToolResult({
			output: output !== null ? output : this.output,
			error: error !== null ? error : this.error,
			base64Image: base64Image !== null ? base64Image : this.base64Image,
		});
	}
}

class ComputerTool {
	name: string;
	apiType: string;
	width: number;
	height: number;
	displayNum: number | null;
	displayPrefix: string;
	_screenshotDelay: number;
	_scalingEnabled: boolean;

	constructor() {
		this.name = "computer";
		this.apiType = "computer_20241022";

		this.width = Number.parseInt("1400") || 0;
		this.height = Number.parseInt("780") || 0;

		if (!this.width || !this.height) {
			throw new Error("WIDTH and HEIGHT environment variables must be set");
		}

		const displayNum = process.env.DISPLAY_NUM;
		if (displayNum !== undefined) {
			this.displayNum = Number.parseInt(displayNum);
			this.displayPrefix = `DISPLAY=:${this.displayNum} `;
		} else {
			this.displayNum = null;
			this.displayPrefix = "";
		}

		this._screenshotDelay = 2.0;
		this._scalingEnabled = true;
	}

	public options() {
		const [width, height] = this.scaleCoordinates(
			"computer",
			this.width,
			this.height,
		);
		return {
			display_width_px: width,
			display_height_px: height,
			display_number: this.displayNum,
		};
	}

	async call({
		action,
		text = null,
		coordinate = null,
	}: { action: Action; text?: string | null; coordinate?: number[] | null }) {
		try {
			if (action === "mouse_move" || action === "left_click_drag") {
				if (!coordinate)
					throw new ToolError(`coordinate is required for ${action}`);
				if (text) throw new ToolError(`text is not accepted for ${action}`);
				if (!Array.isArray(coordinate) || coordinate.length !== 2)
					throw new ToolError(`${coordinate} must be an array of length 2`);
				if (!coordinate.every((i) => Number.isInteger(i) && i >= 0))
					throw new ToolError(
						`${coordinate} must be an array of non-negative integers`,
					);

				const [x, y] = this.scaleCoordinates(
					"api",
					coordinate[0],
					coordinate[1],
				);

				if (action === "mouse_move") {
					return await this.shell(`cliclick m:${x},${y}`);
				}
				if (action === "left_click_drag") {
					return await this.shell(`cliclick dd:${x},${y} w:100 du:${x},${y}`);
				}
			}

			if (action === "key" || action === "type") {
				if (text === null)
					throw new ToolError(`text is required for ${action}`);
				if (coordinate)
					throw new ToolError(`coordinate is not accepted for ${action}`);
				if (typeof text !== "string")
					throw new ToolError(`${text} must be a string`);

				if (action === "key") {
					return await this.shell(`cliclick kp:${text}`);
				}
				if (action === "type") {
					const results: ToolResult[] = [];
					for (const chunk of this.chunks(text, 50)) {
						const cmd = `cliclick t:"${chunk}"`;
						results.push(await this.shell(cmd, false));
					}
					const screenshotBase64 = (await this.screenshot()).base64Image;
					return new ToolResult({
						output: results.map((r) => r.output).join(""),
						error: results.map((r) => r.error).join(""),
						base64Image: screenshotBase64,
					});
				}
			}

			if (
				action === "left_click" ||
				action === "right_click" ||
				action === "double_click" ||
				action === "middle_click" ||
				action === "screenshot" ||
				action === "cursor_position"
			) {
				if (text) throw new ToolError(`text is not accepted for ${action}`);
				if (coordinate)
					throw new ToolError(`coordinate is not accepted for ${action}`);

				if (action === "screenshot") {
					return await this.screenshot();
				}
				if (action === "cursor_position") {
					const result = await this.shell("cliclick p:");
					const output = result.output || "";
					const [xStr, yStr] = output
						.trim()
						.split(",")
						.map((s) => s.trim());
					const x = Number.parseInt(xStr);
					const y = Number.parseInt(yStr);
					const [scaledX, scaledY] = this.scaleCoordinates("computer", x, y);
					return result.replace({ output: `X=${scaledX},Y=${scaledY}` });
				}

				const clickArg = {
					left_click: "c:.",
					right_click: "rc:.",
					middle_click: "mc:.",
					double_click: "dc:.",
				}[action];

				return await this.shell(`cliclick ${clickArg}`);
			}

			throw new ToolError(`Invalid action: ${action}`);
		} catch (error) {
			if (error instanceof ToolError) {
				console.error(error.message);
			} else {
				console.error("An unexpected error occurred:", error);
			}
		}
	}

	async screenshot(): Promise<ToolResult> {
		const outputDir = OUTPUT_DIR;
		if (!existsSync(outputDir)) {
			mkdirSync(outputDir, { recursive: true });
		}
		const filename = `screenshot_${Date.now()}.png`;
		const filepath = join(outputDir, filename);

		const screenshotCmd = `screencapture -x ${filepath}`;

		const result = await this.shell(screenshotCmd, false);

		if (this._scalingEnabled) {
			const [x, y] = this.scaleCoordinates("computer", this.width, this.height);
			await this.shell(`sips -Z ${Math.max(x, y)} ${filepath}`, false);
		}

		if (existsSync(filepath)) {
			const imageData = readFileSync(filepath);
			const base64Image = imageData.toString("base64");
			return result.replace({ base64Image });
		}
		throw new ToolError(`Failed to take screenshot: ${result.error}`);
	}

	async shell(command: string, takeScreenshot = true): Promise<ToolResult> {
		return new Promise((resolve, reject) => {
			exec(command, async (error, stdout, stderr) => {
				let base64Image: string | null = null;
				if (takeScreenshot) {
					await new Promise((res) =>
						setTimeout(res, this._screenshotDelay * 1000),
					);
					base64Image = (await this.screenshot()).base64Image;
				}
				if (error) {
					reject(new ToolResult({ error: stderr, base64Image }));
				} else {
					resolve(
						new ToolResult({ output: stdout, error: stderr, base64Image }),
					);
				}
			});
		});
	}

	scaleCoordinates(source: string, x: number, y: number): [number, number] {
		if (!this._scalingEnabled) {
			return [x, y];
		}
		const ratio = this.width / this.height;
		let targetDimension: ScalingTarget | null = null;
		for (const dimension of Object.values(MAX_SCALING_TARGETS)) {
			if (Math.abs(dimension.width / dimension.height - ratio) < 0.02) {
				if (dimension.width < this.width) {
					targetDimension = dimension;
					break;
				}
			}
		}
		if (!targetDimension) {
			return [x, y];
		}
		const xScalingFactor = targetDimension.width / this.width;
		const yScalingFactor = targetDimension.height / this.height;
		if (source === "api") {
			if (x > this.width || y > this.height) {
				throw new ToolError(`Coordinates ${x}, ${y} are out of bounds`);
			}
			return [Math.round(x / xScalingFactor), Math.round(y / yScalingFactor)];
		}
		return [Math.round(x * xScalingFactor), Math.round(y * yScalingFactor)];
	}

	chunks(s: string, chunkSize: number): string[] {
		const result = [];
		for (let i = 0; i < s.length; i += chunkSize) {
			result.push(s.slice(i, i + chunkSize));
		}
		return result;
	}
}

export { ComputerTool, ToolError, ToolResult, type Action };
