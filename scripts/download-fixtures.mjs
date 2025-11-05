#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";

const SOURCE_BASE = process.env.SOURCE_BASE?.replace(/\/+$/, "") || "https://r4.smarthealthit.org";
const PATIENT_COUNT_RAW = process.env.PATIENT_COUNT ?? "10";
const PATIENT_PAGE_SIZE = Number(process.env.PATIENT_PAGE_SIZE || 200);
const PRACTITIONER_COUNT = Number(process.env.PRACTITIONER_COUNT || 10);
const PRACTITIONER_ROLE_COUNT = Number(process.env.PRACTITIONER_ROLE_COUNT || 10);
const OUTPUT_DIR = path.resolve(process.env.OUTPUT_DIR || path.join(process.cwd(), "fixtures"));
const RELATED_PERSON_COUNT = Number(process.env.RELATED_PERSON_COUNT || 10);
const PATIENT_COUNT = PATIENT_COUNT_RAW.toLowerCase?.() === "all" ? 0 : Number(PATIENT_COUNT_RAW || 0);

let cachedFetch = globalThis.fetch;
async function getFetch() {
    if (typeof cachedFetch === "function") {
        return cachedFetch;
    }
    const mod = await import("node-fetch");
    cachedFetch = mod.default;
    return cachedFetch;
}

async function fetchJson(url) {
    const fetch = await getFetch();
    const res = await fetch(url, {
        headers: {
            accept: "application/fhir+json"
        }
    });

    if (!res.ok) {
        const body = await res.text();
        throw new Error(`HTTP ${res.status} for ${url}\n${body}`);
    }

    return res.json();
}

function resolveUrl(url) {
    if (!url) return null;
    try {
        return new URL(url, SOURCE_BASE).href;
    } catch (err) {
        console.error(`Invalid URL encountered: ${url}`);
        return null;
    }
}

async function collectPatientIds() {
    const ids = new Set();
    const visited = new Set();

    let nextUrl = new URL(`${SOURCE_BASE}/Patient`);
    const pageSize = PATIENT_COUNT > 0 ? Math.min(PATIENT_PAGE_SIZE, PATIENT_COUNT) : PATIENT_PAGE_SIZE;
    nextUrl.searchParams.set("_count", pageSize);
    nextUrl.searchParams.set("_format", "json");

    while (nextUrl) {
        const urlString = nextUrl.href;
        if (visited.has(urlString)) {
            console.error(`Detected loop while paging Patient search at ${urlString}, stopping.`);
            break;
        }
        visited.add(urlString);

        console.error(`Fetching patient list page ${visited.size} from ${urlString}`);
        const bundle = await fetchJson(urlString);
        await fs.writeFile(
            path.join(OUTPUT_DIR, `patient-search-${String(visited.size).padStart(2, "0")}.json`),
            JSON.stringify(bundle, null, 2) + "\n",
            "utf8"
        );

        const patientEntries = Array.isArray(bundle.entry) ? bundle.entry : [];
        for (const entry of patientEntries) {
            const id = entry?.resource?.id;
            if (id) {
                ids.add(id);
                if (PATIENT_COUNT > 0 && ids.size >= PATIENT_COUNT) {
                    return Array.from(ids).slice(0, PATIENT_COUNT);
                }
            }
        }

        if (PATIENT_COUNT > 0 && ids.size >= PATIENT_COUNT) {
            break;
        }

        const nextLink = (bundle.link || []).find(link => link.relation === "next");
        if (nextLink?.url) {
            nextUrl = new URL(resolveUrl(nextLink.url));
        } else {
            break;
        }
    }

    return Array.from(ids);
}

async function main() {
    await fs.mkdir(OUTPUT_DIR, { recursive: true });

    const existing = await fs.readdir(OUTPUT_DIR).catch(() => []);
    await Promise.all(existing
        .filter(name => name.startsWith("patient-search"))
        .map(name => fs.rm(path.join(OUTPUT_DIR, name), { force: true }))
    );

    const patientIds = await collectPatientIds();

    if (!patientIds.length) {
        throw new Error("No patients returned from search");
    }

    for (const id of patientIds) {
        const everythingUrl = `${SOURCE_BASE}/Patient/${id}/$everything?_format=json`;
        console.error(`Fetching $everything for patient ${id}`);
        const everythingBundle = await fetchJson(everythingUrl);
        await fs.writeFile(
            path.join(OUTPUT_DIR, `patient-${id}-everything.json`),
            JSON.stringify(everythingBundle, null, 2) + "\n",
            "utf8"
        );
    }

    const fetchAndWrite = async (relativeUrl, filename) => {
        const url = `${SOURCE_BASE}/${relativeUrl}`;
        console.error(`Fetching ${relativeUrl} from ${url}`);
        const bundle = await fetchJson(url);
        await fs.writeFile(
            path.join(OUTPUT_DIR, filename),
            JSON.stringify(bundle, null, 2) + "\n",
            "utf8"
        );
    };

    if (PRACTITIONER_COUNT > 0) {
        await fetchAndWrite(`Practitioner?_count=${PRACTITIONER_COUNT}&_format=json`, "practitioners.json");
    }

    if (PRACTITIONER_ROLE_COUNT > 0) {
        await fetchAndWrite(`PractitionerRole?_count=${PRACTITIONER_ROLE_COUNT}&_format=json`, "practitioner-roles.json");
    }

    if (RELATED_PERSON_COUNT > 0) {
        await fetchAndWrite(`RelatedPerson?_count=${RELATED_PERSON_COUNT}&_format=json`, "related-persons.json");
    }

    console.error(`Fetched data for ${patientIds.length} patients plus practitioner data into ${OUTPUT_DIR}`);
}

main().catch(err => {
    console.error(err);
    process.exitCode = 1;
});
