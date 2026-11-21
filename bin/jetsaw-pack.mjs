#!/usr/bin/env node
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

const PACK_TYPES = ["stack", "integration", "workflow", "bundle"];
const NAME_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const SEMVER_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const HOST_RE = /^(\*\.)?[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+(:\d{1,5})?$/;
const SETTING_REF_RE = /^\{[A-Za-z][A-Za-z0-9]*\}$/;
const EXEC_RE = /^(\/[^\0]+|[A-Za-z0-9._+-]+)$/;

const PACK_FIELDS = ["schema", "type", "name", "version", "description", "license", "requires", "depends", "detect", "defaults", "inputs"];
const PLUGIN_FIELDS = ["schema", "name", "version", "description", "protocol", "provides", "capabilities", "kinds", "command", "permissions"];
const PORTS = ["tracker", "forge"];
const CAPABILITIES = [
  "tracker.read", "tracker.children", "tracker.versions", "tracker.release",
  "tracker.history", "tracker.account", "tracker.comment", "tracker.priority",
  "forge.read", "forge.review", "forge.threads", "forge.open", "forge.probe", "forge.connection",
];

const CONTENT = {
  knowledge: ["stack", "integration", "workflow"],
  skills: ["workflow"],
  agents: ["stack", "workflow"],
  flows: ["workflow"],
  templates: ["workflow"],
  guard: ["stack", "integration", "workflow"],
  commands: ["stack", "integration", "workflow"],
  evals: ["workflow"],
};

const KNOWLEDGE = ["rules", "snippets"];
const DEFAULTS = {
  stack: ["qa"],
  integration: ["tracker", "forge"],
  workflow: ["autonomy", "flows"],
  bundle: null,
};
const PROJECT_ONLY = ["schema", "name", "repositories", "packs"];

const isObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
const isTextList = (v) => Array.isArray(v) && v.every((x) => typeof x === "string" && x.trim() !== "");

function walkEntries(dir) {
  const out = [];
  const walk = (rel) => {
    for (const entry of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
      const child = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink()) throw new Error(`${child} is a symbolic link: packages hold plain files only`);
      if (entry.isDirectory()) walk(child);
      else if (entry.isFile()) {
        if (fs.statSync(path.join(dir, child)).nlink > 1) throw new Error(`${child} is a hard link: packages hold plain files only`);
        out.push(child);
      } else {
        throw new Error(`${child} is neither a folder nor a plain file`);
      }
    }
  };
  walk("");
  return out.sort();
}

function validatePack(dir, entries) {
  const problems = [];
  let doc;
  try {
    doc = JSON.parse(fs.readFileSync(path.join(dir, "pack.json"), "utf8"));
  } catch (err) {
    return { kind: "pack", problems: [`pack.json is not valid JSON: ${err.message}`] };
  }
  if (!isObject(doc)) return { kind: "pack", problems: ["pack.json must be a JSON object"] };

  for (const key of Object.keys(doc)) {
    if (!PACK_FIELDS.includes(key)) problems.push(`pack.json: unknown field "${key}"`);
  }
  if (doc.schema !== 1) problems.push("pack.json: schema must be 1");
  if (!PACK_TYPES.includes(doc.type)) problems.push(`pack.json: type must be one of ${PACK_TYPES.join(", ")}`);
  if (typeof doc.name !== "string" || !NAME_RE.test(doc.name)) problems.push("pack.json: invalid name");
  if (typeof doc.version !== "string" || !SEMVER_RE.test(doc.version)) problems.push("pack.json: version must be X.Y.Z");
  if (doc.detect !== undefined && doc.type !== "stack") problems.push("pack.json: detect is allowed on stack packs only");
  if (doc.defaults !== undefined) {
    if (!isObject(doc.defaults)) problems.push("pack.json: defaults must be an object");
    else if (PACK_TYPES.includes(doc.type)) {
      const allowed = DEFAULTS[doc.type];
      for (const key of Object.keys(doc.defaults)) {
        if (PROJECT_ONLY.includes(key)) problems.push(`pack.json: defaults.${key} is project-only`);
        else if (allowed && !allowed.includes(key)) problems.push(`pack.json: defaults.${key} is not allowed in a ${doc.type} pack (${allowed.join(", ")})`);
      }
    }
  }

  for (const rel of entries) {
    if (rel === "pack.json") continue;
    const [top, second] = rel.split("/");
    const allowedTypes = CONTENT[top];
    if (!allowedTypes || !rel.includes("/")) {
      problems.push(`${rel}: allowed top-level folders beside pack.json are ${Object.keys(CONTENT).join("/, ")}/`);
      continue;
    }
    if (PACK_TYPES.includes(doc.type) && !allowedTypes.includes(doc.type)) {
      problems.push(`${rel}: a ${doc.type} pack cannot contain ${top}/`);
      continue;
    }
    if (top === "knowledge" && !KNOWLEDGE.includes(second)) {
      problems.push(`${rel}: pack knowledge only allows rules/ and snippets/ (context, glossary, and landmines belong to the project)`);
    }
  }

  return { kind: "pack", name: doc.name, version: doc.version, problems };
}

function validatePlugin(dir) {
  const problems = [];
  let doc;
  try {
    doc = JSON.parse(fs.readFileSync(path.join(dir, "plugin.json"), "utf8"));
  } catch (err) {
    return { kind: "plugin", problems: [`plugin.json is not valid JSON: ${err.message}`] };
  }
  if (!isObject(doc)) return { kind: "plugin", problems: ["plugin.json must be a JSON object"] };

  for (const key of Object.keys(doc)) {
    if (!PLUGIN_FIELDS.includes(key)) problems.push(`plugin.json: unknown field "${key}"`);
  }
  if (doc.schema !== 1) problems.push("plugin.json: schema must be 1");
  if (typeof doc.name !== "string" || !NAME_RE.test(doc.name)) problems.push("plugin.json: invalid name");
  if (typeof doc.version !== "string" || !SEMVER_RE.test(doc.version)) problems.push("plugin.json: version must be X.Y.Z");
  if (typeof doc.protocol !== "string" || !/^\^\d+$/.test(doc.protocol)) problems.push("plugin.json: protocol must be ^<major> (e.g. ^1)");
  if (!isObject(doc.provides) || !Object.keys(doc.provides).length) {
    problems.push("plugin.json: provides must declare tracker and/or forge");
  } else {
    for (const [port, kind] of Object.entries(doc.provides)) {
      if (!PORTS.includes(port)) problems.push(`plugin.json: provides.${port} is not a valid port (${PORTS.join(", ")})`);
      else if (typeof kind !== "string" || !NAME_RE.test(kind)) problems.push(`plugin.json: provides.${port} must be a valid kind name`);
    }
  }
  if (!isTextList(doc.capabilities) || !doc.capabilities.length) {
    problems.push("plugin.json: capabilities must be a non-empty list");
  } else {
    for (const cap of doc.capabilities) {
      if (!CAPABILITIES.includes(cap)) problems.push(`plugin.json: unknown capability "${cap}"`);
    }
  }
  if (!isTextList(doc.command) || !doc.command.length) problems.push("plugin.json: command must be a non-empty string array");
  if (doc.permissions !== undefined) {
    if (!isObject(doc.permissions)) problems.push("plugin.json: permissions must be an object");
    else {
      for (const [key, value] of Object.entries(doc.permissions)) {
        if (!["hosts", "executables", "credentials"].includes(key)) problems.push(`plugin.json: unknown permissions.${key}`);
        else if (!isTextList(value)) problems.push(`plugin.json: permissions.${key} must be a string array`);
        else if (key === "hosts") {
          for (const h of value) {
            if (!HOST_RE.test(h) && !SETTING_REF_RE.test(h)) problems.push(`plugin.json: invalid host "${h}"`);
          }
        } else if (key === "executables") {
          for (const e of value) {
            if (!EXEC_RE.test(e)) problems.push(`plugin.json: invalid executable "${e}"`);
          }
        }
      }
    }
  }

  return { kind: "plugin", name: doc.name, version: doc.version, problems };
}

function inspectPackage(dir) {
  const abs = path.resolve(dir);
  const hasPack = fs.existsSync(path.join(abs, "pack.json"));
  const hasPlugin = fs.existsSync(path.join(abs, "plugin.json"));
  if (hasPack && hasPlugin) throw new Error(`${abs} has both pack.json and plugin.json`);
  if (!hasPack && !hasPlugin) throw new Error(`${abs} has neither pack.json nor plugin.json`);

  const entries = walkEntries(abs);
  const result = hasPack ? validatePack(abs, entries) : validatePlugin(abs);
  if (result.problems.length) {
    throw new Error(`${abs} failed validation:\n${result.problems.map((p) => `  - ${p}`).join("\n")}`);
  }
  return { abs, entries, ...result };
}

async function buildArchive(info, outDir) {
  const absOut = path.resolve(outDir);
  fs.mkdirSync(absOut, { recursive: true });
  const archive = path.join(absOut, `${info.kind}-${info.name}-${info.version}.tar.gz`);
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "jetsaw-pack-"));
  const listFile = path.join(tmpDir, "entries");
  fs.writeFileSync(listFile, `${info.entries.join("\n")}\n`);
  try {
    await run("tar", ["-czf", archive, "-C", info.abs, "--no-mac-metadata", "-T", listFile], {
      env: { ...process.env, COPYFILE_DISABLE: "1" },
    }).catch(async (err) => {
      if (!/no-mac-metadata/.test(String(err.stderr ?? ""))) throw err;
      await run("tar", ["-czf", archive, "-C", info.abs, "-T", listFile], {
        env: { ...process.env, COPYFILE_DISABLE: "1" },
      });
    });
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
  const sha256 = createHash("sha256").update(fs.readFileSync(archive)).digest("hex");
  return { archive, sha256 };
}

const args = process.argv.slice(2);
const cmd = args.shift();
const outIdx = args.indexOf("--out");
let outDir = "dist";
if (outIdx >= 0) {
  outDir = args[outIdx + 1] ?? "dist";
  args.splice(outIdx, 2);
}
const target = args[0];

if (!cmd || !target || !["validate", "build"].includes(cmd)) {
  console.error("Usage:\n  jetsaw-pack validate <folder>\n  jetsaw-pack build <folder> [--out <dir>]");
  process.exit(1);
}

try {
  const info = inspectPackage(target);
  if (cmd === "validate") {
    console.log(`OK  ${info.kind} ${info.name}@${info.version} (${info.entries.length} files)`);
  } else {
    const { archive, sha256 } = await buildArchive(info, outDir);
    console.log(`BUILT  ${info.kind} ${info.name}@${info.version} -> ${archive}\nsha256 ${sha256}`);
  }
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}
