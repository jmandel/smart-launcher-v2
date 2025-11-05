#!/usr/bin/env node
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const SCRIPT_DIR = path.resolve(new URL(".", import.meta.url).pathname);
const ROOT = path.resolve(SCRIPT_DIR, "..");
const SUBMODULE_DIR = path.join(ROOT, "submodules", "patient-browser");
const DIST_DIR = path.join(SUBMODULE_DIR, "dist");
const TARGET_DIR = path.join(ROOT, "public", "patient-browser");

if (!fs.existsSync(SUBMODULE_DIR)) {
    console.error("patient-browser submodule not found at", SUBMODULE_DIR);
    process.exit(1);
}

const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";

function run(command, cwd) {
    execSync(command, {
        cwd,
        stdio: "inherit",
        env: process.env
    });
}

try {
    const basePath = (process.env.PATIENT_BROWSER_BASE_PATH || "/patient-browser/").replace(/\/*$/, "/");
    process.env.PATIENT_BROWSER_BASE_PATH = basePath;

    if (!fs.existsSync(path.join(SUBMODULE_DIR, "node_modules"))) {
        run(`${npmCmd} install`, SUBMODULE_DIR);
    }

    run(`${npmCmd} run build -- --base=${basePath}`, SUBMODULE_DIR);

    fs.rmSync(TARGET_DIR, { recursive: true, force: true });
    fs.mkdirSync(TARGET_DIR, { recursive: true });

    fs.cpSync(DIST_DIR, TARGET_DIR, { recursive: true });

    const indexPath = path.join(TARGET_DIR, "index.html");
    if (fs.existsSync(indexPath)) {
        let html = fs.readFileSync(indexPath, "utf8");
        const escapedBase = basePath.replace(/\/*$/, "/");
        html = html.replace(/href="\/(?!patient-browser\/)/g, `href="${escapedBase}`);
        html = html.replace(/src="\/(?!patient-browser\/)/g, `src="${escapedBase}`);
        fs.writeFileSync(indexPath, html);
    }

    console.log("Patient browser assets copied to", TARGET_DIR);
} catch (err) {
    console.error(err);
    process.exitCode = 1;
}
