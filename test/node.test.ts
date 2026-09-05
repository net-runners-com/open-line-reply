import { describe, expect, test, mock } from "bun:test";
import { nodeHandler, ReplyRouter, text } from "../src/node";

const SECRET = "test-secret";

async function sign(body: string, secret = SECRET): Promise<string> {
	const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
	const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
	let s = "";
	for (const byte of new Uint8Array(mac)) s += String.fromCharCode(byte);
	return btoa(s);
}

// node:http の req/res を最小モックで再現
function mockReq(opts: { method?: string; url?: string; headers?: Record<string, string>; body?: string }) {
	const listeners: Record<string, ((arg?: unknown) => void)[]> = {};
	const req = {
		method: opts.method ?? "POST",
		url: opts.url ?? "/webhook",
		headers: opts.headers ?? {},
		on(event: string, cb: (arg?: unknown) => void) {
			(listeners[event] ??= []).push(cb);
			return req;
		},
		_fire() {
			for (const cb of listeners.data ?? []) cb(opts.body ?? "");
			for (const cb of listeners.end ?? []) cb();
		},
	};
	return req;
}
function mockRes() {
	return { statusCode: 0, headers: {} as Record<string, string>, body: "", setHeader(n: string, v: string) { this.headers[n] = v; }, end(b?: string) { this.body = b ?? ""; } };
}

async function run(handler: ReturnType<typeof nodeHandler>, reqOpts: Parameters<typeof mockReq>[0]) {
	const req = mockReq(reqOpts);
	const res = mockRes();
	const p = handler(req as never, res as never);
	req._fire();
	await p;
	return res;
}

const textEventBody = (t: string) =>
	JSON.stringify({ destination: "x", events: [{ type: "message", replyToken: "rt-1", source: { type: "user", userId: "U1" }, timestamp: 0, message: { type: "text", id: "m", text: t } }] });

describe("nodeHandler", () => {
	test("404 for non-webhook path", async () => {
		const h = nodeHandler({ channelSecret: SECRET, channelAccessToken: "tok", router: new ReplyRouter() });
		const res = await run(h, { url: "/other", body: "{}" });
		expect(res.statusCode).toBe(404);
	});

	test("401 for bad signature", async () => {
		const h = nodeHandler({ channelSecret: SECRET, channelAccessToken: "tok", router: new ReplyRouter().onText("hi", () => text("x")) });
		const res = await run(h, { headers: { "x-line-signature": "bad" }, body: textEventBody("hi") });
		expect(res.statusCode).toBe(401);
	});

	test("200 and calls reply on valid signature", async () => {
		const fetchMock = mock(async () => new Response("{}", { status: 200 }));
		const orig = globalThis.fetch;
		globalThis.fetch = fetchMock as unknown as typeof fetch;
		try {
			const h = nodeHandler({ channelSecret: SECRET, channelAccessToken: "tok", router: new ReplyRouter().onText("hi", () => text("hello")) });
			const body = textEventBody("hi");
			const res = await run(h, { headers: { "x-line-signature": await sign(body) }, body });
			expect(res.statusCode).toBe(200);
			expect(fetchMock).toHaveBeenCalledTimes(1);
		} finally {
			globalThis.fetch = orig;
		}
	});
});
