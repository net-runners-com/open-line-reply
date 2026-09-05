import { describe, expect, test } from "bun:test";
import { matchAutoReply, isSilent, autoReplyRouter, type AutoReplyRow } from "../src/line-harness";
import { text, type LineEvent } from "../src/index";

const rows: AutoReplyRow[] = [
	{ keyword: "料金", match_type: "contains", response_type: "flex", response_content: '{"type":"bubble"}', is_active: 1 },
	{ keyword: "メニュー", match_type: "exact", response_type: "text", response_content: "メニューです", is_active: 1 },
	{ keyword: "stop", match_type: "exact", response_type: "silent", response_content: "", is_active: 1 },
	{ keyword: "旧", match_type: "contains", response_type: "text", response_content: "無効", is_active: 0 },
];

describe("matchAutoReply", () => {
	test("contains match", () => {
		expect(matchAutoReply("料金を教えて", rows)?.response_type).toBe("flex");
	});
	test("exact match only on exact", () => {
		expect(matchAutoReply("メニュー", rows)?.response_content).toBe("メニューです");
		expect(matchAutoReply("メニューを見せて", rows)).toBeNull(); // exact なので部分一致しない
	});
	test("first row wins", () => {
		const r: AutoReplyRow[] = [
			{ keyword: "a", match_type: "contains", response_type: "text", response_content: "first" },
			{ keyword: "a", match_type: "contains", response_type: "text", response_content: "second" },
		];
		expect(matchAutoReply("aaa", r)?.response_content).toBe("first");
	});
	test("inactive rows skipped", () => {
		expect(matchAutoReply("旧バージョン", rows)).toBeNull();
	});
	test("silent row is returned (caller decides)", () => {
		const hit = matchAutoReply("stop", rows);
		expect(hit && isSilent(hit)).toBe(true);
	});
	test("regex metachars in keyword are literal (via router), but matchAutoReply uses includes", () => {
		const r: AutoReplyRow[] = [{ keyword: "a.b", match_type: "contains", response_type: "text", response_content: "x" }];
		expect(matchAutoReply("xxa.bxx", r)?.response_content).toBe("x");
		expect(matchAutoReply("xxaXbxx", r)).toBeNull(); // "." はリテラル
	});
});

const ev = (t: string): LineEvent => ({
	type: "message", replyToken: "rt", source: { type: "user", userId: "U" }, timestamp: 0,
	message: { type: "text", id: "m", text: t },
});
const pb = (data: string): LineEvent => ({
	type: "postback", replyToken: "rt", source: { type: "user", userId: "U" }, timestamp: 0,
	postback: { data },
});

describe("autoReplyRouter", () => {
	const router = autoReplyRouter(rows, {
		build: (type, content) => (type === "text" ? text(content) : { type, contents: JSON.parse(content), altText: "x" }),
		onDefault: () => text("?"),
	});

	test("text contains → flex", async () => {
		const out = await router.dispatch(ev("料金は？"));
		expect((out[0] as { type: string }).type).toBe("flex");
	});
	test("exact text → text", async () => {
		const out = await router.dispatch(ev("メニュー"));
		expect((out[0] as { text: string }).text).toBe("メニューです");
	});
	test("silent → no message", async () => {
		const out = await router.dispatch(ev("stop"));
		expect(out).toEqual([]);
	});
	test("postback also routed", async () => {
		const out = await router.dispatch(pb("メニュー"));
		expect((out[0] as { text: string }).text).toBe("メニューです");
	});
	test("default for unmatched", async () => {
		const out = await router.dispatch(ev("なにか"));
		expect((out[0] as { text: string }).text).toBe("?");
	});
	test("regex keyword is escaped (literal dot)", async () => {
		const r = autoReplyRouter([{ keyword: "a.b", match_type: "contains", response_type: "text", response_content: "hit" }], {
			build: (_t, c) => text(c),
		});
		expect(((await r.dispatch(ev("za.bz")))[0] as { text: string }).text).toBe("hit");
		expect(await r.dispatch(ev("zaXbz"))).toEqual([]);
	});
});
