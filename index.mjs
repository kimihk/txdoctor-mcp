#!/usr/bin/env node
/* txdoctor-mcp — zero-dependency MCP server over stdio.
   Solana transaction failure diagnostics: 202 error entries across 12 programs,
   cross-program code collisions, log decoding. Data: https://txdoctor.app */

import { createInterface } from "node:readline";
import data from "./data.json" with { type: "json" };

const PROTOCOL_VERSION = "2025-06-18";
const { programNames, programCodes, entries } = data;

/* ---------------------------------------------------------------- lookups */

const byId = new Map(entries.map((e) => [e.id, e]));

/** Normalize "0x1773" / "6003" → { num, hex }. Returns null when unparseable. */
function parseCode(raw) {
  const s = String(raw).trim().toLowerCase();
  let num;
  if (/^0x[0-9a-f]+$/.test(s)) num = parseInt(s, 16);
  else if (/^\d+$/.test(s)) num = parseInt(s, 10);
  else return null;
  if (!Number.isInteger(num) || num < 0 || num > 4294967295) return null;
  return { num, hex: "0x" + num.toString(16) };
}

/** Entry ids that carry this code, grouped by owning program. */
function ownersOf(num) {
  const out = [];
  for (const [pid, codes] of Object.entries(programCodes)) {
    const id = codes[String(num)];
    if (id && byId.has(id)) out.push({ pid, name: programNames[pid] || pid, entry: byId.get(id) });
  }
  return out;
}

function crossIndex(num) {
  return ownersOf(num);
}

function listPrograms() {
  return Object.entries(programCodes)
    .map(([pid, codes]) => ({
      pid,
      name: programNames[pid] || pid,
      codes: Object.keys(codes).length,
    }))
    .sort((a, b) => b.codes - a.codes);
}

/* ------------------------------------------------------- log line parsing */

/* Matches, in one pass: Anchor "custom program error: 0x/dec" after a Program
   ... failed line, "Error Code: N" Anchor panic style, and bare native codes. */
const FAIL_RE =
  /Program\s+([1-9A-HJ-NP-Za-km-z]{32,44})\s+failed:\s+(?:custom program error:\s*(0x[0-9a-fA-F]+|\d+)|Error Code:\s*(\d+)|error:\s*(0x[0-9a-fA-F]+|\d+))/gi;
const LOOSE_RE =
  /(?:custom program error|Error Code|error)[:\s]+(0x[0-9a-fA-F]+|\b\d{1,10}\b)/gi;

function decodeLog(log) {
  const events = [];
  let m;
  FAIL_RE.lastIndex = 0;
  while ((m = FAIL_RE.exec(log)) !== null) {
    const pid = m[1];
    const codeRaw = m[2] ?? m[3] ?? m[4];
    const code = parseCode(codeRaw);
    if (!code) continue;
    events.push({ pid, name: programNames[pid] || null, code });
  }
  if (events.length === 0) {
    // No program attribution in the text — fall back to loose code scan so the
    // caller still gets the collision map, flagged as "program unknown".
    LOOSE_RE.lastIndex = 0;
    const seen = new Set();
    while ((m = LOOSE_RE.exec(log)) !== null) {
      const code = parseCode(m[1]);
      if (!code || seen.has(code.num)) continue;
      seen.add(code.num);
      events.push({ pid: null, name: null, code });
    }
  }
  return events;
}

/* ------------------------------------------------------------ rendering */

function renderEntry(e, indent) {
  const pad = " ".repeat(indent);
  return [
    `${pad}**${e.title}** — ${e.badge} (severity: ${e.severity})`,
    `${pad}${e.summary}`,
    "",
    `${pad}Likely causes:`,
    ...e.why.map((w) => `${pad}- ${w}`),
    "",
    `${pad}Fixes:`,
    ...e.fix.map((f) => `${pad}- ${f}`),
    "",
    `${pad}Example log: \`${e.example}\``,
    `${pad}Full page: ${e.url}`,
  ].join("\n");
}

function renderCode(num, hex, knownName) {
  const owners = crossIndex(num);
  if (knownName) {
    // The caller's program first; the rest keep catalogue order.
    owners.sort((a, b) => (b.name === knownName ? 1 : 0) - (a.name === knownName ? 1 : 0));
  }
  if (owners.length === 0) {
    return (
      `No catalogue entry for custom error code ${hex} (decimal ${num}).\n` +
      `Covered programs: ${listPrograms().map((p) => p.name).join(", ")}.\n` +
      `The code may come from a program outside this catalogue — read the program ID in the log line first.`
    );
  }
  const lines = [];
  const n = owners.length;
  const distinct = new Set(owners.map((o) => o.entry.title.toLowerCase())).size;
  lines.push(
    `Error code ${hex} (decimal ${num}) is claimed by ${n} program${n > 1 ? "s" : ""} with ${distinct} distinct meaning${distinct > 1 ? "s" : ""}.` +
      (knownName ? `\n\nProgram: **${knownName}** — details below.` : n > 1 ? `\n\n⚠️ Same code, different meanings: identify the program ID from the log before acting.` : "")
  );
  for (const o of owners) {
    lines.push("", `### ${o.name} \`${o.pid}\``, "");
    lines.push(renderEntry(o.entry, 0));
  }
  if (n > 1 && !knownName) {
    lines.push(
      "",
      `### How to tell which one is yours`,
      `1. Find the line \`Program <pubkey> failed: custom program error: ${hex}\` in the logs — that pubkey names the program.`,
      `2. If the pubkey is gone, infer from instruction context: tick arrays → CLMM (Orca / Raydium CLMM / Meteora DLMM); bins → Meteora DLMM; bonding-curve accounts → pump.fun / Raydium LaunchLab.`,
      `3. ${hex} and ${num} are the same code in different bases.`
    );
  }
  return lines.join("\n");
}

function renderLogDecode(log) {
  const events = decodeLog(log);
  if (events.length === 0) {
    return (
      `No custom program error found in the log.\n` +
      `This tool decodes lines like:\n` +
      `- \`Program <pubkey> failed: custom program error: 0x1773\`\n` +
      `- \`Program <pubkey> failed: Error Code: 30\`\n` +
      `For non-custom failures (blockhash, signature, compute budget), see https://txdoctor.app/why-did-my-transaction-fail/`
    );
  }
  const parts = [];
  for (const ev of events) {
    parts.push(renderCode(ev.code.num, ev.code.hex, ev.name));
  }
  return parts.join("\n\n---\n\n");
}

/* ------------------------------------------------------------- MCP layer */

const TOOLS = [
  {
    name: "lookup_error",
    description:
      "Look up a Solana program error code by hex (0x1773) or decimal (6003). " +
      "Returns every program's meaning for that code — cross-program collisions included — " +
      "with likely causes, fixes and an example log line for each. Covers Jupiter, Raydium (CPMM/CLMM/AMM v4/LaunchLab), " +
      "Orca, Meteora (DLMM/AMM), pump.fun, SPL Token, Token-2022.",
    inputSchema: {
      type: "object",
      properties: {
        code: { type: "string", description: "Error code in hex (0x1773) or decimal (6003)" },
      },
      required: ["code"],
    },
  },
  {
    name: "decode_log",
    description:
      "Paste a Solana transaction log (or any text containing a failure line). Extracts the failed " +
      "program ID and error code, then returns the exact meaning for that program — plus the " +
      "cross-program collision map when the program is unknown.",
    inputSchema: {
      type: "object",
      properties: {
        log: { type: "string", description: "Transaction log text or any text containing an error line" },
      },
      required: ["log"],
    },
  },
  {
    name: "list_programs",
    description: "List the Solana programs covered by this catalogue and how many error codes each has.",
    inputSchema: { type: "object", properties: {} },
  },
];

function handleToolCall(name, args) {
  switch (name) {
    case "lookup_error": {
      const code = parseCode(args?.code);
      if (!code)
        return { content: [{ type: "text", text: `Invalid code: "${args?.code}". Use hex (0x1773) or decimal (6003).` }], isError: true };
      return { content: [{ type: "text", text: renderCode(code.num, code.hex, null) }] };
    }
    case "decode_log": {
      const log = String(args?.log ?? "");
      if (!log.trim())
        return { content: [{ type: "text", text: "Empty log. Paste the transaction log text." }], isError: true };
      return { content: [{ type: "text", text: renderLogDecode(log) }] };
    }
    case "list_programs": {
      const rows = listPrograms().map((p) => `- **${p.name}** — ${p.codes} codes — \`${p.pid}\``);
      return {
        content: [
          {
            type: "text",
            text:
              `${entries.length} error entries across ${rows.length} programs. Source: https://txdoctor.app\n\n` +
              rows.join("\n"),
          },
        ],
      };
    }
    default:
      return { content: [{ type: "text", text: `Unknown tool: ${name}` }], isError: true };
  }
}

/* ------------------------------------------------- stdio JSON-RPC loop */

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + "\n");
}

const rl = createInterface({ input: process.stdin, terminal: false });
rl.on("line", (line) => {
  const t = line.trim();
  if (!t) return;
  let msg;
  try {
    msg = JSON.parse(t);
  } catch {
    return; // ignore non-JSON noise on stdin
  }
  if (msg.jsonrpc !== "2.0" || typeof msg.method !== "string") return;

  if (msg.method === "initialize") {
    send({
      jsonrpc: "2.0",
      id: msg.id,
      result: {
        protocolVersion: typeof msg.params?.protocolVersion === "string" ? msg.params.protocolVersion : PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: "txdoctor-mcp", version: "0.1.0" },
      },
    });
    return;
  }
  if (msg.method.startsWith("notifications/")) return; // no response for notifications
  if (msg.method === "ping") {
    send({ jsonrpc: "2.0", id: msg.id, result: {} });
    return;
  }
  if (msg.method === "tools/list") {
    send({ jsonrpc: "2.0", id: msg.id, result: { tools: TOOLS } });
    return;
  }
  if (msg.method === "tools/call") {
    let result;
    try {
      result = handleToolCall(msg.params?.name, msg.params?.arguments);
    } catch (err) {
      result = { content: [{ type: "text", text: `Internal error: ${err.message}` }], isError: true };
    }
    send({ jsonrpc: "2.0", id: msg.id, result });
    return;
  }
  send({
    jsonrpc: "2.0",
    id: msg.id,
    error: { code: -32601, message: `Method not found: ${msg.method}` },
  });
});

process.stderr.write(`txdoctor-mcp ready: ${entries.length} entries, ${Object.keys(programCodes).length} programs\n`);
