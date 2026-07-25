// Companion to herdr-agent-state: report subagent activity as "working"
// Installed beside the managed integration — not editing it directly.

import net from "node:net";

const HERDR_ENV = process.env.HERDR_ENV;
const socketPath = process.env.HERDR_SOCKET_PATH;
const socketEndpoint =
  process.platform === "win32" && socketPath ? `\\\\.\\pipe\\${socketPath}` : socketPath;
const paneId = process.env.HERDR_PANE_ID;

function enabled() {
  return HERDR_ENV === "1" && !!socketPath && !!paneId;
}

let reportSeq = Date.now() * 1000;
function nextSeq(): number { reportSeq += 1; return reportSeq; }

function sendRequest(request: unknown): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    const socket = net.createConnection(socketEndpoint!);
    const finish = () => { if (!done) { done = true; socket.destroy(); resolve(); } };
    socket.on("error", finish);
    socket.on("connect", () => socket.write(`${JSON.stringify(request)}\n`));
    socket.on("data", finish);
    socket.on("end", finish);
    setTimeout(finish, 1500).unref?.();
  });
}

function sendState(state: string, message?: string): Promise<void> {
  return sendRequest({
    id: `herdr:pi-subagent:${Date.now()}:${Math.random().toString(36).slice(2)}`,
    method: "pane.report_agent",
    params: {
      pane_id: paneId,
      source: "herdr:pi",
      agent: "pi",
      state,
      message,
      seq: nextSeq(),
    },
  });
}

export default function (pi: any) {
  if (!enabled()) return;

  let subagentActive = false;

  // Subagent tools: ant_colony and subagent keep pi "working"
  const SUBAGENT_TOOLS = new Set(["ant_colony", "subagent"]);

  pi.on("tool_execution_start", async (event: any, ctx: any) => {
    if (SUBAGENT_TOOLS.has(event.toolName) && !subagentActive) {
      subagentActive = true;
      await sendState("working", `Subagent: ${event.toolName}`);
    }
  });

  pi.on("tool_execution_end", async (event: any, ctx: any) => {
    if (SUBAGENT_TOOLS.has(event.toolName) && subagentActive) {
      subagentActive = false;
      // Let the main extension restore idle when agent_settled fires
      await sendState("working", "Returning from subagent…");
    }
  });
}
