// Smoke tests for the built package (no browser needed).
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const require = createRequire(import.meta.url);
let passed = 0;
const test = async (name, fn) => {
    try {
        await fn();
        passed++;
        console.log("  ok  ", name);
    } catch (e) {
        console.error("  FAIL", name, "\n", e);
        process.exitCode = 1;
    }
};

const esm = await import("../dist/esm/index.js");
const cjs = require("../dist/cjs/index.cjs");

await test("ESM and CJS both export CreptaPay (named + default)", () => {
    assert.equal(typeof esm.CreptaPay, "function");
    assert.equal(esm.default, esm.CreptaPay);
    assert.equal(typeof cjs.CreptaPay, "function");
    assert.equal(cjs.default, cjs.CreptaPay);
});

await test("script build sets window.CreptaPay", () => {
    const code = readFileSync(new URL("../dist/creptapay.js", import.meta.url), "utf8");
    const sandbox = { window: {}, URL, fetch: () => {} };
    sandbox.window = sandbox;
    vm.runInNewContext(code, sandbox);
    assert.equal(typeof sandbox.CreptaPay, "function");
    assert.equal(typeof sandbox.CreptaPay.CreptaPayError, "function");
    assert.match(sandbox.CreptaPay.version, /^\d+\.\d+\.\d+/);
});

const { CreptaPay, CreptaPayError } = esm;

await test("rejects missing, secret and malformed keys", () => {
    assert.throws(() => new CreptaPay({}), CreptaPayError);
    assert.throws(() => new CreptaPay({ publicKey: "sk_test_x" }), /secret key/);
    assert.throws(() => new CreptaPay({ publicKey: "abc" }), /pk_/);
});

await test("environment follows the key", () => {
    assert.equal(new CreptaPay({ publicKey: "pk_test_1" }).environment, "sandbox");
    assert.equal(new CreptaPay({ publicKey: "pk_live_1" }).environment, "production");
});

await test("initialize() validates input before calling the API", async () => {
    const c = new CreptaPay({ publicKey: "pk_test_1" });
    await assert.rejects(c.initialize({ customer: { email: "a@b.c", first_name: "A", last_name: "B" } }), /amount or items/);
    await assert.rejects(c.initialize({ amount: 0, customer: { email: "a@b.c", first_name: "A", last_name: "B" } }), /greater than 0/);
    await assert.rejects(c.initialize({ amount: 5 }), /customer/);
});

await test("initialize() posts the right request and maps the response", async () => {
    const calls = [];
    globalThis.fetch = async (url, init) => {
        calls.push({ url, init });
        return new Response(
            JSON.stringify({
                message: "ok",
                data: {
                    id: "p1",
                    reference: "ref123",
                    checkout_url: "https://checkout.creptapay.online/ref123",
                    status: "pending",
                    amount: 25,
                    total: 25,
                    currency: "USD",
                    redirect_url: "https://shop.test/done",
                    metadata: { order_id: "42" },
                    expires_at: "2026-09-20T00:00:00Z",
                },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
        );
    };
    const c = new CreptaPay({ publicKey: "pk_test_abc", apiUrl: "https://api.test/v1/" });
    const p = await c.initialize({
        amount: 25,
        customer: { email: "a@b.c", first_name: "Ada", last_name: "L" },
        redirectUrl: "https://shop.test/done",
        metadata: { order_id: "42" },
    });
    assert.equal(calls[0].url, "https://api.test/v1/payment");
    assert.equal(calls[0].init.method, "POST");
    assert.equal(calls[0].init.headers["x-api-key"], "pk_test_abc");
    const body = JSON.parse(calls[0].init.body);
    assert.equal(body.amount, 25);
    assert.equal(body.currency, "USD");
    assert.equal(body.redirect_url, "https://shop.test/done");
    assert.deepEqual(body.metadata, { order_id: "42" });
    assert.equal(p.reference, "ref123");
    assert.equal(p.checkoutUrl, "https://checkout.creptapay.online/ref123");
    assert.equal(p.redirectUrl, "https://shop.test/done");
    assert.deepEqual(p.metadata, { order_id: "42" });
});

await test("API errors become CreptaPayError with status", async () => {
    globalThis.fetch = async () =>
        new Response(JSON.stringify({ message: "Invalid API key format" }), { status: 401 });
    const c = new CreptaPay({ publicKey: "pk_test_1" });
    const err = await c.initialize({ amount: 5, customer: { email: "a@b.c", first_name: "A", last_name: "B" } }).catch((e) => e);
    assert.ok(err instanceof CreptaPayError);
    assert.equal(err.status, 401);
    assert.equal(err.message, "Invalid API key format");
});

await test("network failure becomes a friendly CreptaPayError", async () => {
    globalThis.fetch = async () => {
        throw new TypeError("fetch failed");
    };
    const c = new CreptaPay({ publicKey: "pk_test_1" });
    await assert.rejects(c.getPayment("ref"), /Could not reach CreptaPay/);
});

console.log(`\n${passed} passed${process.exitCode ? ", some FAILED" : ""}`);
