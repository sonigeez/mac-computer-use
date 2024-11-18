const messageInput = document.querySelector(".message-input");
const sendButton = document.querySelector(".send-button");
const chatMessages = document.querySelector(".chat-messages");
const pushToTalkButton = document.querySelector(".push-to-talk");

const conversationHistory = [];
let mediaRecorder;
let isRecording = false;
let audioChunks = [];

const tools = [
	{
		type: "computer_20241022",
		name: "computer",
		display_width_px: 1440,
		display_height_px: 768,
		display_number: 1,
	},
];

async function initializeRecording() {
	try {
		const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
		mediaRecorder = new MediaRecorder(stream);

		mediaRecorder.ondataavailable = async (event) => {
			if (event.data.size > 0) {
				const reader = new FileReader();
				reader.readAsDataURL(event.data);
				reader.onloadend = async () => {
					try {
						const response = await fetch(
							"https://api.deepgram.com/v1/listen?model=nova-2&smart_format=true",
							{
								method: "POST",
								headers: {
									Authorization: "Token DEEPGRAM_API_KEY",
									"Content-Type": "audio/wav",
								},
								body: event.data,
							},
						);

						const data = await response.json();
						const transcript =
							data.results.channels[0].alternatives[0].transcript;

						messageInput.value = transcript;
						sendMessage();
					} catch (error) {
						console.error("Error transcribing audio:", error);
					}
				};
			}
		};
	} catch (error) {
		console.error("Error accessing microphone:", error);
	}
}

pushToTalkButton.addEventListener("mousedown", () => {
	if (!mediaRecorder) {
		initializeRecording().then(() => {
			startRecording();
		});
	} else {
		startRecording();
	}
});

pushToTalkButton.addEventListener("mouseup", () => {
	stopRecording();
});

pushToTalkButton.addEventListener("mouseleave", () => {
	if (isRecording) {
		stopRecording();
	}
});

function startRecording() {
	if (mediaRecorder && mediaRecorder.state === "inactive") {
		mediaRecorder.start();
		isRecording = true;
		pushToTalkButton.classList.add("recording");
	}
}

function stopRecording() {
	if (mediaRecorder && mediaRecorder.state === "recording") {
		mediaRecorder.stop();
		isRecording = false;
		pushToTalkButton.classList.remove("recording");
	}
}

async function sendMessage() {
	const message = messageInput.value.trim();
	if (!message) return;

	addMessageToChat(message, "sent");
	conversationHistory.push({
		role: "user",
		content: [{ type: "text", text: message }],
	});

	const loadingElement = addMessageToChat("Thinking...", "received loading");
	connectWebSocket();

	try {
		await processConversation();
	} catch (error) {
		console.error("Error:", error);
		addMessageToChat(
			"Sorry, there was an error processing your message.",
			"received",
		);
	} finally {
		removeMessageFromChat(loadingElement);
		resetInputState();
	}
}

async function processConversation() {
	let loadingElement = null;
	while (true) {
		const response = await callClaudeAPI(conversationHistory);
		console.log("Response:", response);
		if (response.content) {
			if (response.content.length > 0) {
				if (response.content[0].type === "text") {
					playAudio(response.content[0].text);
				}
			}
		}

		if (loadingElement) {
			removeMessageFromChat(loadingElement);
		}

		const assistantMessage = response.content || response.text;
		if (!assistantMessage) {
			throw new Error("Invalid response from API");
		}

		let hasToolUse = false;

		if (Array.isArray(assistantMessage)) {
			for (const contentBlock of assistantMessage) {
				if (contentBlock.type === "text") {
					addMessageToChat(contentBlock.text, "received");
					conversationHistory.push({
						role: "assistant",
						content: [contentBlock],
					});
				} else if (contentBlock.type === "tool_use") {
					hasToolUse = true;
					conversationHistory.push({
						role: "assistant",
						content: [contentBlock],
					});

					const toolResult = await handleToolUse(contentBlock);
					conversationHistory.push({ role: "user", content: [toolResult] });
					loadingElement = addMessageToChat(
						"Processing tool result...",
						"received loading",
					);
				}
			}
		} else {
			addMessageToChat(assistantMessage, "received");
			conversationHistory.push({
				role: "assistant",
				content: [{ type: "text", text: assistantMessage }],
			});
		}

		if (!hasToolUse) {
			break;
		}
	}
}

async function callClaudeAPI(conversation) {
	console.log(
		"Sending API request to Claude with conversation history:",
		conversation,
	);
	const response = await fetch("https://api.anthropic.com/v1/messages", {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			"x-api-key": "CLAUDE_API_KEY",
			"anthropic-version": "2023-06-01",
			"anthropic-dangerous-direct-browser-access": "true",
			"anthropic-beta": "computer-use-2024-10-22",
		},
		body: JSON.stringify({
			model: "claude-3-5-sonnet-20241022",
			max_tokens: 1024,
			tools: tools,
			messages: conversation,
		}),
	});

	if (!response.ok) {
		console.error("API request failed with status:", response.status);
		throw new Error("API request failed");
	}

	const data = await response.json();
	console.log("Claude API response data:", data);

	if (data.content || data.text) {
		return data;
	}
	throw new Error("Invalid response structure");
}

async function handleToolUse(toolUse) {
	const toolInput = toolUse.input;
	const toolName = toolUse.name;
	const toolUseId = toolUse.id;

	try {
		console.log("Processing tool use request:", toolInput);

		const toolResultContent = [];
		let isError = false;
		if (toolName === "computer") {
			console.log("Processing computer tool use request:", toolInput);
			const computerToolResult = window.api.computerTool(
				toolInput.action,
				toolInput.text,
				toolInput.coordinate,
			);
			console.log("Computer tool result:", computerToolResult);
			toolResultContent.push({
				type: "text",
				text: "task done",
			});
		} else {
			isError = true;
			toolResultContent.push({
				type: "text",
				text: `Error: Unknown tool ${toolName}`,
			});
		}

		return {
			type: "tool_result",
			content: toolResultContent,
			tool_use_id: toolUseId,
			is_error: isError,
		};
	} catch (error) {
		console.error("Tool use action failed:", error);
		return {
			type: "tool_result",
			content: [{ type: "text", text: `Error: ${error.message}` }],
			tool_use_id: toolUseId,
			is_error: true,
		};
	}
}

const config = {
	USER_ID: "",
	API_KEY: "",
	MODEL: "Play3.0-mini",
};

async function getAuthenticatedWebSocketUrl() {
	const url = "https://api.play.ai/api/v1/tts/auth";
	const headers = {
		Authorization: `Bearer ${config.API_KEY}`,
		"X-User-Id": config.USER_ID,
		"Content-Type": "application/json",
	};

	const response = await fetch(url, {
		method: "POST",
		headers: headers,
	});

	if (!response.ok) {
		throw new Error(
			`Failed to get authenticated websocket URL: ${response.status} ${response.statusText}`,
		);
	}

	const result = await response.json();
	return result[config.MODEL].webSocketUrl;
}

let wsUrl = "";
getAuthenticatedWebSocketUrl().then((url) => {
	wsUrl = url;
	console.log(wsUrl);
});

let socket;

function connectWebSocket() {
	return new Promise((resolve, reject) => {
		socket = new WebSocket(wsUrl);
		socket.onmessage = async (event) => {
			console.log("Received message from WebSocket:", event.data);
			if (typeof event.data === "string") {
				try {
					const metadata = JSON.parse(event.data);
					if (metadata.request_id) {
						const audioBlob = new Blob(audioChunks, { type: "audio/wav" });
						const audioUrl = URL.createObjectURL(audioBlob);
						const audio = new Audio(audioUrl);
						audio.onended = () => {
							URL.revokeObjectURL(audioUrl);
						};
						audio.play();
						audioChunks = [];
					}
				} catch (e) {
					console.error("Error parsing message:", e);
				}
			} else if (event.data instanceof Blob) {
				audioChunks.push(event.data);
			}
		};
		socket.onopen = () => {
			console.log("WebSocket connection established");
			resolve(socket);
		};

		socket.onerror = (error) => {
			console.error("WebSocket error:", error);
			reject(error);
		};
	});
}

function generateRandomHex(length) {
	return Array.from({ length }, () =>
		Math.floor(Math.random() * 16).toString(16),
	).join("");
}

async function playAudio(text) {
	console.log("Sending text to WebSocket:", text);
	if (socket && socket.readyState === WebSocket.OPEN) {
		currentRequestId = generateRandomHex(16);
		const command = {
			text: text,
			voice:
				"s3://voice-cloning-zero-shot/775ae416-49bb-4fb6-bd45-740f205d20a1/jennifersaad/manifest.json",
			request_id: currentRequestId,
			speed: 1.6,
		};
		socket.send(JSON.stringify(command));
	} else {
		socket = await connectWebSocket();
		currentRequestId = generateRandomHex(16);
		const command = {
			text: text,
			voice:
				"s3://voice-cloning-zero-shot/775ae416-49bb-4fb6-bd45-740f205d20a1/jennifersaad/manifest.json",
			request_id: currentRequestId,
			speed: 1.6,
		};
		socket.send(JSON.stringify(command));
	}
}

function addMessageToChat(content, className) {
	const messageElement = document.createElement("div");
	messageElement.className = `message ${className}`;

	if (typeof content === "string") {
		messageElement.textContent = content;
	} else if (Array.isArray(content)) {
		for (const block of content) {
			if (block.type === "text") {
				const textElement = document.createElement("p");
				textElement.textContent = block.text;
				messageElement.appendChild(textElement);
			}
		}
	}

	chatMessages.appendChild(messageElement);
	chatMessages.scrollTop = chatMessages.scrollHeight;
	return messageElement;
}

function removeMessageFromChat(element) {
	if (element?.parentNode) {
		element.parentNode.removeChild(element);
	}
}

function resetInputState() {
	messageInput.value = "";
	messageInput.disabled = false;
	sendButton.disabled = false;
	messageInput.focus();
}

sendButton.addEventListener("click", sendMessage);
messageInput.addEventListener("keypress", (e) => {
	if (e.key === "Enter") {
		sendMessage();
	}
});
