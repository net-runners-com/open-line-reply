import { describe, expect, test, mock } from "bun:test";
import {
	verifySignature,
	ReplyRouter,
	createWebhookHandler,
	text,
	flex,
	buttonsTemplate,
	carouselTemplate,
	postbackAction,
	quickReply,
	qr,
	messageAction,
	type LineEvent,
} from "../src/index";

const SECRET = "test-secret";

async function sign(body: string, secret = SECRET): Promise<string> {
	const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
	const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
	let s = "";
	for (const byte of new Uint8Array(mac)) s += String.fromCharCode(byte);
	return btoa(s);
}

const textEvent = (t: string): LineEvent => ({
	type: "message",
	replyToken: "rt-123",
	source: { type: "user", userId: "U1" },
	timestamp: Date.now(),
	message: { type: "text", id: "m1", text: t },
});

describe("verifySignature", () => {
	test("valid signature passes", async () => {
		const body = JSON.stringify({ hello: "world" });
		expect(await verifySignature(body, await sign(body), SECRET)).toBe(true);
	});
	test("wrong signature fails", async () => {
		const body = JSON.stringify({ hello: "world" });
		expect(await verifySignature(body, await sign(body, "other"), SECRET)).toBe(false);
	});
	test("null signature fails", async () => {
		expect(await verifySignature("{}", null, SECRET)).toBe(false);
	});
});

describe("message builders", () => {
	test("text with quickReply and sender", () => {
		const m = text("hi", { quickReply: quickReply(qr(messageAction("yes"))), sender: { name: "Bot" } });
		expect(m.type).toBe("text");
		expect(m.text).toBe("hi");
		expect(m.quickReply?.items[0]?.action.type).toBe("message");
		expect(m.sender?.name).toBe("Bot");
	});
	test("flex", () => {
		const m = flex("alt", { type: "bubble" });
		expect(m).toEqual({ type: "flex", altText: "alt", contents: { type: "bubble" } });
	});
	test("buttons template", () => {
		const m = buttonsTemplate({ text: "choose", actions: [postbackAction("a", "A")] });
		expect((m.template as { type: string }).type).toBe("buttons");
	});
	test("carousel template", () => {
		const m = carouselTemplate([{ text: "c1", actions: [messageAction("x")] }], "alt");
		expect((m.template as { type: string }).type).toBe("carousel");
	});
});

describe("ReplyRouter.dispatch", () => {
	test("exact text match", async () => {
		const r = new ReplyRouter().onText("hi", () => text("hello"));
		const out = await r.dispatch(textEvent("hi"));
		expect(out).toEqual([text("hello")]);
	});
	test("regex text match exposes ctx.match", async () => {
		const r = new ReplyRouter().onText(/^count (\d+)$/, (_e, ctx) => text(`n=${ctx.match?.[1]}`));
		const out = await r.dispatch(textEvent("count 42"));
		expect((out[0] as { text: string }).text).toBe("n=42");
	});
	test("default handler for unmatched", async () => {
		const r = new ReplyRouter().onText("hi", () => text("hello")).onDefault(() => text("?"));
		const out = await r.dispatch(textEvent("nope"));
		expect((out[0] as { text: string }).text).toBe("?");
	});
	test("postback match", async () => {
		const r = new ReplyRouter().onPostback("act=buy", () => text("bought"));
		const out = await r.dispatch({ type: "postback", replyToken: "rt", source: { type: "user", userId: "U" }, timestamp: 0, postback: { data: "act=buy" } });
		expect((out[0] as { text: string }).text).toBe("bought");
	});
	test("follow handler", async () => {
		const r = new ReplyRouter().onFollow(() => text("welcome"));
		const out = await r.dispatch({ type: "follow", replyToken: "rt", source: { type: "user", userId: "U" }, timestamp: 0 });
		expect((out[0] as { text: string }).text).toBe("welcome");
	});
	test("unmatched with no default returns []", async () => {
		const r = new ReplyRouter().onText("hi", () => text("hello"));
		expect(await r.dispatch(textEvent("nope"))).toEqual([]);
	});
});

describe("createWebhookHandler", () => {
	test("rejects invalid signature (401, no reply)", async () => {
		const router = new ReplyRouter().onText("hi", () => text("hello"));
		const handle = createWebhookHandler({ channelSecret: SECRET, channelAccessToken: "tok", router });
		const res = await handle(JSON.stringify({ events: [] }), "bad");
		expect(res.ok).toBe(false);
		expect(res.status).toBe(401);
	});

	test("valid signature dispatches and calls reply API", async () => {
		const fetchMock = mock(async () => new Response("{}", { status: 200 }));
		const orig = globalThis.fetch;
		globalThis.fetch = fetchMock as unknown as typeof fetch;
		try {
			const router = new ReplyRouter().onText("hi", () => text("hello"));
			const handle = createWebhookHandler({ channelSecret: SECRET, channelAccessToken: "tok", router });
			const body = JSON.stringify({ destination: "x", events: [textEvent("hi")] });
			const res = await handle(body, await sign(body));
			expect(res.ok).toBe(true);
			expect(res.replies.length).toBe(1);
			expect(fetchMock).toHaveBeenCalledTimes(1);
			const call = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
			expect(call[0]).toBe("https://api.line.me/v2/bot/message/reply");
			const sent = JSON.parse(call[1].body as string);
			expect(sent.replyToken).toBe("rt-123");
			expect(sent.messages[0].text).toBe("hello");
			expect((call[1].headers as Record<string, string>).Authorization).toBe("Bearer tok");
		} finally {
			globalThis.fetch = orig;
		}
	});

	test("no reply when handler returns nothing and no replyToken use", async () => {
		const fetchMock = mock(async () => new Response("{}", { status: 200 }));
		const orig = globalThis.fetch;
		globalThis.fetch = fetchMock as unknown as typeof fetch;
		try {
			const router = new ReplyRouter().onText("hi", () => text("hello"));
			const handle = createWebhookHandler({ channelSecret: SECRET, channelAccessToken: "tok", router });
			const body = JSON.stringify({ destination: "x", events: [textEvent("unmatched")] });
			await handle(body, await sign(body));
			expect(fetchMock).toHaveBeenCalledTimes(0);
		} finally {
			globalThis.fetch = orig;
		}
	});
});
