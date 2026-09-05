// 素の Node.js(Windows/macOS/Linux)で動く最小例。
//   npm install
//   set LINE_CHANNEL_SECRET=...        (PowerShell: $env:LINE_CHANNEL_SECRET="...")
//   set LINE_CHANNEL_ACCESS_TOKEN=...
//   node index.mjs
// 公開URL(ngrok 等)を LINE Developers の Webhook に設定。

import { listen, ReplyRouter, text, buttonsTemplate, postbackAction, flex } from "open-line-reply/node";

const router = new ReplyRouter()
	.onFollow(() => text("友だち追加ありがとうございます！「メニュー」と送ってください。"))
	.onText("メニュー", () =>
		buttonsTemplate({ text: "ご用件をどうぞ", actions: [postbackAction("act=price", "料金を見る")] }),
	)
	.onPostback("act=price", () =>
		flex("料金", {
			type: "bubble",
			body: { type: "box", layout: "vertical", contents: [{ type: "text", text: "初回相談 無料", weight: "bold" }] },
		}),
	)
	.onDefault((_e, ctx) => text(`「${ctx.text}」を受け付けました`));

await listen(
	{
		router,
		channelSecret: process.env.LINE_CHANNEL_SECRET,
		channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
	},
	Number(process.env.PORT ?? 3000),
);
