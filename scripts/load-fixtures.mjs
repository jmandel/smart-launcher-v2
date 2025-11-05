#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";

const BASE_URL = process.env.TARGET_FHIR_BASE?.replace(/\/+$/, "") || "http://localhost:8080/fhir";
const FIXTURES_DIR = path.resolve(process.env.FIXTURES_DIR || path.join(process.cwd(), "fixtures"));
const CONCURRENCY = Number(process.env.CONCURRENCY || 4);

let cachedFetch = globalThis.fetch;
async function getFetch() {
    if (typeof cachedFetch === "function") {
        return cachedFetch;
    }
    const mod = await import("node-fetch");
    cachedFetch = mod.default;
    return cachedFetch;
}

async function runWithConcurrency(limit, items, worker) {
    const active = new Set();
    const results = [];

    for (const item of items) {
        const task = Promise.resolve()
            .then(() => worker(item))
            .finally(() => active.delete(task));

        active.add(task);
        results.push(task);

        if (active.size >= limit) {
            await Promise.race(active);
        }
    }

    await Promise.all(active);
    return Promise.all(results);
}

async function fetchJson(url, options = {}) {
    const fetch = await getFetch();
    const res = await fetch(url, {
        ...options,
        headers: {
            accept: "application/fhir+json",
            "content-type": "application/fhir+json",
            ...(options.headers || {})
        }
    });

    if (!res.ok) {
        const body = await res.text();
        throw new Error(`HTTP ${res.status} for ${options.method || "GET"} ${url}\n${body}`);
    }

    if (res.status === 204) {
        return null;
    }

    return res.json();
}

async function waitForServer(baseUrl, timeoutMs = 300000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        try {
            await fetchJson(`${baseUrl}/metadata?_format=json`);
            return;
        } catch (err) {
            process.stderr.write(`Waiting for FHIR server at ${baseUrl}...\n`);
            await new Promise(resolve => setTimeout(resolve, 5000));
        }
    }
    throw new Error(`Timed out waiting for FHIR server at ${baseUrl}`);
}

async function collectResources(fixturesDir) {
    const entries = await fs.readdir(fixturesDir, { withFileTypes: true });
    const resources = new Map();

    for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith(".json")) {
            continue;
        }

        const filePath = path.join(fixturesDir, entry.name);
        const content = await fs.readFile(filePath, "utf8");
        const bundle = JSON.parse(content);
        const bundleEntries = Array.isArray(bundle.entry) ? bundle.entry : [];

        for (const bundleEntry of bundleEntries) {
            const resource = bundleEntry?.resource;
            if (!resource?.resourceType || !resource.id) {
                continue;
            }
            const key = `${resource.resourceType}/${resource.id}`;
            resources.set(key, resource);
        }
    }

    return Array.from(resources.values());
}

function sanitizeAttachments(input) {
    if (Array.isArray(input)) {
        input.forEach(sanitizeAttachments);
        return;
    }
    if (!input || typeof input !== "object") {
        return;
    }

    if (typeof input.data === "string" && input.data.trim() && typeof input.contentType === "string") {
        const candidate = input.data.trim();
        // If string contains characters outside base64 alphabet, encode as base64
        if (!/^[A-Za-z0-9+/=]+$/.test(candidate)) {
            input.data = Buffer.from(candidate, "utf8").toString("base64");
        }
    }

    for (const value of Object.values(input)) {
        sanitizeAttachments(value);
    }
}

async function uploadResource(baseUrl, resource) {
    const url = `${baseUrl}/${resource.resourceType}/${resource.id}`;
    sanitizeResource(resource);
    const body = JSON.stringify(resource);

    const fetch = await getFetch();
    const res = await fetch(url, {
        method: "PUT",
        headers: {
            "content-type": "application/fhir+json",
            accept: "application/fhir+json"
        },
        body
    });

    if (!res.ok) {
        const text = await res.text();
        throw new Error(`Failed to upload ${resource.resourceType}/${resource.id} -> ${res.status}\n${text}`);
    }
}

const MED_ADMIN_STATUSES = new Set([
    "in-progress",
    "not-done",
    "on-hold",
    "completed",
    "entered-in-error",
    "stopped",
    "unknown"
]);

function sanitizeResource(resource) {
    if (!resource || typeof resource !== "object") {
        return;
    }

    if (resource.resourceType === "MedicationAdministration" && typeof resource.status === "string") {
        if (!MED_ADMIN_STATUSES.has(resource.status)) {
            if (resource.status === "not-taken") {
                resource.status = "not-done";
            } else {
                delete resource.status;
            }
        }
    }

    sanitizeAttachments(resource);
}

async function main() {
    await waitForServer(BASE_URL);
    const resources = await collectResources(FIXTURES_DIR);
    process.stderr.write(`Uploading ${resources.length} resources to ${BASE_URL}...\n`);

    await runWithConcurrency(CONCURRENCY, resources, resource => uploadResource(BASE_URL, resource));
    process.stderr.write("Upload complete.\n");
}

main().catch(err => {
    console.error(err);
    process.exitCode = 1;
});
