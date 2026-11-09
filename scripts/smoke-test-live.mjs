#!/usr/bin/env node
/**
 * scripts/smoke-test-live.mjs
 * Live endpoint smoke test suite for BITA Management System on Vercel.
 *
 * Usage:
 *   node scripts/smoke-test-live.mjs [https://bita-management-system.vercel.app]
 */

const BASE_URL = (process.argv[2] || process.env.BITA_LIVE_URL || "https://bita-management-system.vercel.app").replace(/\/+$/, "");

console.log(`\n🔍 Starting live smoke test against: ${BASE_URL}\n`);

async function fetchWithRetry(url, options = {}, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await fetch(url, options);
    } catch (err) {
      if (attempt === retries) throw err;
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
}

const tests = [
  {
    name: "Web App Login Page (GET /login)",
    path: "/login",
    method: "GET",
    expectedStatus: [200],
    validate: (res, body) => {
      const isHtml = (res.headers.get("content-type") || "").includes("text/html");
      const hasBrand = body.includes("BITA") || body.includes("Bangalore Inspection") || body.includes("login");
      return isHtml && hasBrand;
    },
  },
  {
    name: "Root URL Redirect (GET /)",
    path: "/",
    method: "GET",
    redirect: "manual",
    expectedStatus: [200, 301, 302, 307, 308],
    validate: (res) => {
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get("location") || "";
        return loc.includes("/login") || loc.includes("/dashboard");
      }
      return true;
    },
  },
  {
    name: "Telegram Executive Bot Webhook Status (GET /api/telegram/webhook)",
    path: "/api/telegram/webhook",
    method: "GET",
    expectedStatus: [200],
    validate: (res, body) => {
      try {
        const json = JSON.parse(body);
        return json.ok === true && typeof json.service === "string" && json.service.includes("Telegram");
      } catch {
        return false;
      }
    },
  },
  {
    name: "Reminders Plan Route Secret Guard (POST /api/reminders/plan)",
    path: "/api/reminders/plan",
    method: "POST",
    expectedStatus: [401],
    validate: (res) => res.status === 401,
  },
  {
    name: "Field API Invalid Pairing Code Guard (POST /api/field/pair)",
    path: "/api/field/pair",
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code: "000000" }),
    expectedStatus: [400, 404, 401],
    validate: (res, body) => {
      try {
        const json = JSON.parse(body);
        return Boolean(json.error);
      } catch {
        return false;
      }
    },
  },
  {
    name: "Field Dynamic Report Template Auth Guard - UT (GET /api/field/report-template/UT)",
    path: "/api/field/report-template/UT",
    method: "GET",
    expectedStatus: [401],
    validate: (res, body) => {
      try {
        const json = JSON.parse(body);
        return json.error && json.error.includes("authorization header");
      } catch {
        return false;
      }
    },
  },
  {
    name: "Field Dynamic Report Template Auth Guard - MPT (GET /api/field/report-template/MPT)",
    path: "/api/field/report-template/MPT",
    method: "GET",
    expectedStatus: [401],
    validate: (res, body) => {
      try {
        const json = JSON.parse(body);
        return json.error && json.error.includes("authorization header");
      } catch {
        return false;
      }
    },
  },
  {
    name: "Field Dynamic Report Template Auth Guard - DPT (GET /api/field/report-template/DPT)",
    path: "/api/field/report-template/DPT",
    method: "GET",
    expectedStatus: [401],
    validate: (res, body) => {
      try {
        const json = JSON.parse(body);
        return json.error && json.error.includes("authorization header");
      } catch {
        return false;
      }
    },
  },
];

async function runSmokeTests() {
  let passed = 0;
  let failed = 0;

  for (const test of tests) {
    const url = `${BASE_URL}${test.path}`;
    const startTime = Date.now();
    try {
      const options = {
        method: test.method,
        headers: test.headers || {},
        redirect: test.redirect || "follow",
      };
      if (test.body) {
        options.body = test.body;
      }

      const res = await fetchWithRetry(url, options);
      const elapsed = Date.now() - startTime;
      const body = await res.text();

      const statusOk = test.expectedStatus.includes(res.status);
      const validationOk = typeof test.validate === "function" ? test.validate(res, body) : true;

      if (statusOk && validationOk) {
        console.log(`  ✅ PASS [${res.status}] (${elapsed}ms) - ${test.name}`);
        passed++;
      } else {
        console.error(`  ❌ FAIL [${res.status}] (${elapsed}ms) - ${test.name}`);
        if (!statusOk) {
          console.error(`     Expected HTTP ${test.expectedStatus.join("|")}, got ${res.status}`);
        }
        if (!validationOk) {
          console.error(`     Response body validation failed: ${body.slice(0, 150)}...`);
        }
        failed++;
      }
    } catch (err) {
      const elapsed = Date.now() - startTime;
      console.error(`  ❌ ERROR (${elapsed}ms) - ${test.name}: ${err.message}`);
      failed++;
    }
  }

  console.log(`\n--------------------------------------------------`);
  console.log(`Results: ${passed} passed, ${failed} failed out of ${tests.length} live checks.`);
  console.log(`--------------------------------------------------\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

runSmokeTests();
