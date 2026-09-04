// open-line-reply — LINE Messaging API の「応答メッセージ(reply)」だけを扱う軽量フレームワーク。
//
// なぜ reply だけか:
//   reply API (`POST /v2/bot/message/reply`) は **メッセージ通数(枠)を消費しない**。
//   push / broadcast / multicast / narrowcast は課金対象。
//   → ユーザーのアクション(メッセージ・タップ・友だち追加)に返す限り、Flex でも動画でも無料。
//
// 制約(LINE 側の仕様):
//   - replyToken は 1 イベントに 1 個・使い切り・発行から約 1 分で失効
//   - 1 replyToken につき最大 5 メッセージ
//   - 送信先はそのイベントを起こした本人のみ(能動 push はこのライブラリの範囲外)
//
// 依存ゼロ。Web Crypto を使うので Cloudflare Workers / Deno / Bun / Node 18+ で動く。

// 送信メッセージのビルダー(text/sticker/image/video/audio/location/imagemap/
// template/flex, quickReply, sender, action 各種)は ./messages に全部ある。
export * from "./messages";
import type { ReplyMessage } from "./messages";

// ---------------------------------------------------------------------------
// 受信イベント(webhook payload の必要部分)
// ---------------------------------------------------------------------------

export interface EventSource {
	type: "user" | "group" | "room";
	userId?: string;
	groupId?: string;
	roomId?: string;
}

export interface IncomingMessage {
	type: "text" | "image" | "video" | "audio" | "file" | "location" | "sticker";
	id: string;
	text?: string;
}

export interface Postback {
	data: string;
	params?: Record<string, string>;
}

export interface LineEvent {
	type:
		| "message"
		| "postback"
		| "follow"
		| "unfollow"
		| "join"
		| "leave"
		| "memberJoined"
		| "memberLeft"
		| "beacon";
	replyToken?: string;
	source: EventSource;
	timestamp: number;
	message?: IncomingMessage;
	postback?: Postback;
}

export interface WebhookBody {
	destination: string;
	events: LineEvent[];
}

// ---------------------------------------------------------------------------
// 署名検証: X-Line-Signature = base64( HMAC-SHA256(channelSecret, rawBody) )
// ---------------------------------------------------------------------------

const enc = new TextEncoder();

function base64(bytes: ArrayBuffer): string {
	const b = new Uint8Array(bytes);
	let s = "";
	for (const byte of b) s += String.fromCharCode(byte);
	// btoa は Workers/Deno/Bun/Node18+ でグローバルに存在
	return btoa(s);
}

// タイミング安全な文字列比較
function safeEqual(a: string, b: string): boolean {
	if (a.length !== b.length) return false;
	let diff = 0;
	for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
	return diff === 0;
}

export async function verifySignature(
	rawBody: string,
	signature: string | null,
	channelSecret: string,
): Promise<boolean> {
	if (!signature) return false;
	const key = await crypto.subtle.importKey(
		"raw",
		enc.encode(channelSecret),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);
	const mac = await crypto.subtle.sign("HMAC", key, enc.encode(rawBody));
	return safeEqual(base64(mac), signature);
}

// ---------------------------------------------------------------------------
// reply クライアント
// ---------------------------------------------------------------------------

export const LINE_REPLY_ENDPOINT = "https://api.line.me/v2/bot/message/reply";

export interface ReplyResult {
	ok: boolean;
	status: number;
	body: string;
}

export function createReplyClient(channelAccessToken: string) {
	return async function reply(
		replyToken: string,
		messages: ReplyMessage | ReplyMessage[],
	): Promise<ReplyResult> {
		const list = Array.isArray(messages) ? messages : [messages];
		if (list.length === 0) return { ok: true, status: 0, body: "(no messages)" };
		if (list.length > 5) {
			throw new Error(`reply は最大 5 メッセージ (received ${list.length})`);
		}
		const res = await fetch(LINE_REPLY_ENDPOINT, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${channelAccessToken}`,
			},
			body: JSON.stringify({ replyToken, messages: list }),
		});
		return { ok: res.ok, status: res.status, body: await res.text() };
	};
}

// ---------------------------------------------------------------------------
// ルーター: イベント → 返信メッセージ
// ---------------------------------------------------------------------------

export type Handler = (
	event: LineEvent,
	ctx: HandlerContext,
) => ReplyMessage | ReplyMessage[] | void | Promise<ReplyMessage | ReplyMessage[] | void>;

export interface HandlerContext {
	/** 受信テキスト(message イベントのとき) */
	text?: string;
	/** postback の data */
	data?: string;
	/** 正規表現マッチの結果(onText(RegExp) のとき) */
	match?: RegExpMatchArray;
	/** 送信元 userId 等 */
	source: EventSource;
}

interface TextRoute {
	pattern: string | RegExp;
	handler: Handler;
}
interface PostbackRoute {
	pattern: string | RegExp;
	handler: Handler;
}

export class ReplyRouter {
	private textRoutes: TextRoute[] = [];
	private postbackRoutes: PostbackRoute[] = [];
	private followHandler?: Handler;
	private joinHandler?: Handler;
	private defaultHandler?: Handler;

	/** テキストメッセージにマッチ。string は完全一致、RegExp は test で判定 */
	onText(pattern: string | RegExp, handler: Handler): this {
		this.textRoutes.push({ pattern, handler });
		return this;
	}

	/** postback.data にマッチ */
	onPostback(pattern: string | RegExp, handler: Handler): this {
		this.postbackRoutes.push({ pattern, handler });
		return this;
	}

	/** 友だち追加(follow) */
	onFollow(handler: Handler): this {
		this.followHandler = handler;
		return this;
	}

	/** グループ参加(join) */
	onJoin(handler: Handler): this {
		this.joinHandler = handler;
		return this;
	}

	/** どのルートにも当たらなかったメッセージ/postback */
	onDefault(handler: Handler): this {
		this.defaultHandler = handler;
		return this;
	}

	/** 1 イベントを処理して返信メッセージ配列(または空)を返す */
	async dispatch(event: LineEvent): Promise<ReplyMessage[]> {
		const source = event.source;
		const run = async (h: Handler | undefined, ctx: HandlerContext) => {
			if (!h) return [];
			const r = await h(event, ctx);
			if (!r) return [];
			return Array.isArray(r) ? r : [r];
		};

		if (event.type === "follow") return run(this.followHandler, { source });
		if (event.type === "join") return run(this.joinHandler, { source });

		if (event.type === "message" && event.message?.type === "text") {
			const t = event.message.text ?? "";
			for (const route of this.textRoutes) {
				if (typeof route.pattern === "string") {
					if (route.pattern === t) return run(route.handler, { text: t, source });
				} else {
					const m = t.match(route.pattern);
					if (m) return run(route.handler, { text: t, match: m, source });
				}
			}
			return run(this.defaultHandler, { text: t, source });
		}

		if (event.type === "postback") {
			const d = event.postback?.data ?? "";
			for (const route of this.postbackRoutes) {
				if (typeof route.pattern === "string") {
					if (route.pattern === d) return run(route.handler, { data: d, source });
				} else {
					const m = d.match(route.pattern);
					if (m) return run(route.handler, { data: d, match: m, source });
				}
			}
			return run(this.defaultHandler, { data: d, source });
		}

		return [];
	}
}

// ---------------------------------------------------------------------------
// Webhook 本体(ランタイム非依存): 生 body + 署名 → 検証 → 各イベントに reply
// ---------------------------------------------------------------------------

export interface WebhookConfig {
	channelSecret: string;
	channelAccessToken: string;
	router: ReplyRouter;
	/** ハンドラ内の例外を握りつぶすか(既定 true。1イベントの失敗で他を止めない) */
	swallowErrors?: boolean;
	/** ログ関数(既定 console.error) */
	onError?: (err: unknown, event?: LineEvent) => void;
}

export interface WebhookResult {
	ok: boolean;
	status: number;
	/** 検証失敗など、処理に入れなかった理由 */
	reason?: string;
	/** 各イベントの reply 結果 */
	replies: ReplyResult[];
}

export function createWebhookHandler(config: WebhookConfig) {
	const reply = createReplyClient(config.channelAccessToken);
	const swallow = config.swallowErrors ?? true;
	const onError = config.onError ?? ((e: unknown) => console.error("[open-line-reply]", e));

	return async function handle(rawBody: string, signature: string | null): Promise<WebhookResult> {
		const valid = await verifySignature(rawBody, signature, config.channelSecret);
		if (!valid) return { ok: false, status: 401, reason: "invalid signature", replies: [] };

		let body: WebhookBody;
		try {
			body = JSON.parse(rawBody) as WebhookBody;
		} catch {
			return { ok: false, status: 400, reason: "invalid json", replies: [] };
		}

		const replies: ReplyResult[] = [];
		for (const event of body.events ?? []) {
			try {
				const messages = await config.router.dispatch(event);
				if (messages.length && event.replyToken) {
					replies.push(await reply(event.replyToken, messages));
				}
			} catch (err) {
				onError(err, event);
				if (!swallow) throw err;
			}
		}
		return { ok: true, status: 200, replies };
	};
}
