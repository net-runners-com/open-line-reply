// open-line-reply の Cloudflare Workers 最小例。
// 全部 reply(無料枠を消費しない)で完結する。
//
//   wrangler secret put LINE_CHANNEL_SECRET
//   wrangler secret put LINE_CHANNEL_ACCESS_TOKEN
//   wrangler deploy
// LINE Developers の Webhook URL に https://<worker>/webhook を設定。

import {
	cloudflareHandler,
	ReplyRouter,
	text,
	flex,
	buttonsTemplate,
	postbackAction,
	uriAction,
	quickReply,
	qr,
	messageAction,
} from "open-line-reply/cloudflare";

const router = new ReplyRouter()
	// 友だち追加 → あいさつ(follow イベントも reply なので無料)
	.onFollow(() =>
		text("友だち追加ありがとうございます！「メニュー」と送ると案内を出します。", {
			quickReply: quickReply(qr(messageAction("メニュー"))),
		}),
	)
	// キーワード → ボタンテンプレート
	.onText("メニュー", () =>
		buttonsTemplate({
			text: "ご用件をどうぞ",
			actions: [
				postbackAction("act=price", "料金を見る"),
				uriAction("https://example.com/booking", "予約する"),
			],
		}),
	)
	// postback → Flex(タップ駆動で何段でも無料)
	.onPostback("act=price", () =>
		flex("料金", {
			type: "bubble",
			body: {
				type: "box",
				layout: "vertical",
				contents: [
					{ type: "text", text: "料金プラン", weight: "bold", size: "xl" },
					{ type: "text", text: "初回相談 無料", margin: "md" },
				],
			},
			footer: {
				type: "box",
				layout: "vertical",
				contents: [
					{ type: "button", style: "primary", action: { type: "postback", label: "戻る", data: "act=menu" } },
				],
			},
		}),
	)
	.onPostback("act=menu", () => text("「メニュー」と送ってください。"))
	// 正規表現で数字を拾う
	.onText(/^(\d+)\+(\d+)$/, (_e, ctx) => {
		const a = Number(ctx.match?.[1]);
		const b = Number(ctx.match?.[2]);
		return text(`${a} + ${b} = ${a + b}`);
	})
	// それ以外
	.onDefault((_e, ctx) => text(`「${ctx.text}」は受け付けました。「メニュー」と送ってみてください。`));

export default {
	fetch: cloudflareHandler({
		router,
		channelSecret: (env) => env.LINE_CHANNEL_SECRET as string,
		channelAccessToken: (env) => env.LINE_CHANNEL_ACCESS_TOKEN as string,
	}),
};
