// Minimal LSP-framed JSON-RPC 2.0 connector stub (logs go to stderr, protocol to stdout).

let buffer = Buffer.alloc(0);

function send(message) {
  const body = Buffer.from(JSON.stringify(message), "utf8");
  const header = Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, "utf8");
  process.stdout.write(Buffer.concat([header, body]));
}

function handleMessage(msg) {
  if (msg.method === "initialize") {
    send({
      jsonrpc: "2.0",
      id: msg.id,
      result: {
        protocolVersion: "1.0.0",
        name: "tracker-acme-stub",
        version: "1.0.0",
        capabilities: ["tracker.read"],
      },
    });
    return;
  }

  if (msg.method === "tracker/listIssues") {
    send({ jsonrpc: "2.0", id: msg.id, result: [] });
    return;
  }

  if (msg.method === "shutdown") {
    send({ jsonrpc: "2.0", id: msg.id, result: null });
    return;
  }

  if (msg.method === "exit") {
    process.exit(0);
  }

  if (msg.id !== undefined) {
    send({
      jsonrpc: "2.0",
      id: msg.id,
      error: { code: -32601, message: `Method not found: ${msg.method}` },
    });
  }
}

process.stdin.on("data", (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  while (true) {
    const headerEnd = buffer.indexOf("\r\n\r\n");
    if (headerEnd === -1) return;
    const header = buffer.subarray(0, headerEnd).toString("utf8");
    const match = /Content-Length:\s*(\d+)/i.exec(header);
    if (!match) return;
    const length = Number(match[1]);
    const bodyStart = headerEnd + 4;
    if (buffer.length < bodyStart + length) return;
    const body = buffer.subarray(bodyStart, bodyStart + length).toString("utf8");
    buffer = buffer.subarray(bodyStart + length);
    handleMessage(JSON.parse(body));
  }
});
