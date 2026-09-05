# open-line-reply

LINE Messaging API の **応答メッセージ (reply) だけ**を扱う、依存ゼロの軽量フレームワーク。

## なぜ reply だけか

reply API (`POST /v2/bot/message/reply`) は **メッセージ通数(無料枠)を消費しない**。
push / broadcast / multicast / narrowcast は課金対象。

> ユーザーのアクション（メッセージ・タップ・友だち追加）に返す限り、Flex でも動画でも **無料**。

このライブラリは push を持たない。「無料の範囲だけで LINE bot を組む」ことに割り切っている。

> **補足（誤解しやすい点）**: 「無料 = replyToken 必須」ではない。無料経路は2つある。
> ① Messaging API の **reply**（replyToken 依存・相手のアクション直後のみ・受け身）＝このパッケージ。
> ② chat.line.biz の **運用者送信**（**replyToken 不要**・いつでも能動的に・ただし過去に話しかけてきた人限定）。
> ②は別ツール（Cookie 直叩きの operator API）で、このパッケージの対象外。
> 「無料で好きなタイミングに送りたい」なら②、「相手の反応に自動で返したい」なら①。

### reply の制約（LINE 側の仕様）

- `replyToken` は 1 イベントに 1 個・使い切り・発行から **約 1 分で失効**
- 1 `replyToken` につき **最大 5 メッセージ**
- 送信先は **そのイベントを起こした本人のみ**（能動 push は範囲外）

時間差のステップ配信（例: 3日後に自動送信）は reply では作れない。
その代わり **postback ボタンで連鎖**させれば、タップ駆動のステップは何段でも無料。

## 特徴

- 依存ゼロ。Web Crypto を使うので **Cloudflare Workers / Deno / Bun / Node 20+**（Windows・macOS・Linux）で動く。OS 依存コードなし
- Webhook 署名検証（`X-Line-Signature`）込み
- キーワード / 正規表現 / postback / follow / join のルーター
- **全メッセージタイプのビルダー**: text / textV2(emoji) / sticker / image / video / audio / location / imagemap / template(buttons, confirm, carousel, image_carousel) / flex
- quickReply・sender(アイコン/名前差し替え)・action 各種

## インストール

```bash
bun add open-line-reply      # または npm i / pnpm add
```

## 使い方（ランタイム非依存コア）

```ts
import { createWebhookHandler, ReplyRouter, text, flex } from "open-line-reply";

const router = new ReplyRouter()
  .onFollow(() => text("友だち追加ありがとうございます！"))
  .onText("メニュー", () => flex("メニュー", { type: "bubble", /* ... */ }))
  .onText(/^(\d+)\+(\d+)$/, (_e, ctx) =>
    text(`${Number(ctx.match![1]) + Number(ctx.match![2])}`))
  .onPostback("act=buy", () => text("購入ありがとうございます"))
  .onDefault((_e, ctx) => text(`「${ctx.text}」を受け付けました`));

const handle = createWebhookHandler({
  channelSecret: process.env.LINE_CHANNEL_SECRET!,
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN!,
  router,
});

// 生のリクエストボディと署名ヘッダを渡すだけ
const result = await handle(rawBody, signatureHeader);
// result.status === 401 なら署名不正
```

## 使い方（Cloudflare Workers）

```ts
import { cloudflareHandler, ReplyRouter, text } from "open-line-reply/cloudflare";

const router = new ReplyRouter().onText("hi", () => text("hello"));

export default {
  fetch: cloudflareHandler({
    router,
    channelSecret: (env) => env.LINE_CHANNEL_SECRET,
    channelAccessToken: (env) => env.LINE_CHANNEL_ACCESS_TOKEN,
    // path: "/webhook" (既定)
  }),
};
```

```bash
wrangler secret put LINE_CHANNEL_SECRET
wrangler secret put LINE_CHANNEL_ACCESS_TOKEN
wrangler deploy
```

LINE Developers コンソールで Webhook URL に `https://<worker>/webhook` を設定。

完全な例は [`examples/cloudflare-worker`](./examples/cloudflare-worker) を参照。

## 使い方（素の Node.js / Windows・macOS・Linux）

Bun も Cloudflare も使わず、Node.js だけで webhook サーバを立てられる（**Node 20+ 推奨**。
Node 18 でも `node:crypto` の webcrypto を自動フォールバックする）。

```ts
import { listen, ReplyRouter, text } from "open-line-reply/node";

const router = new ReplyRouter().onText("hi", () => text("hello"));

listen(
  {
    router,
    channelSecret: process.env.LINE_CHANNEL_SECRET,
    channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  },
  3000, // port
);
```

`node:http` / Express 互換の `(req, res)` ハンドラだけ欲しい場合は `nodeHandler(config)`。

### Windows での起動（PowerShell）

```powershell
cd examples\node-server
npm install
$env:LINE_CHANNEL_SECRET="..."
$env:LINE_CHANNEL_ACCESS_TOKEN="..."
node index.mjs
```

コマンドプロンプト (cmd) の場合は `set LINE_CHANNEL_SECRET=...`。
外部公開は ngrok / Cloudflare Tunnel 等で `http://localhost:3000/webhook` を公開し、
その URL を LINE Developers の Webhook に設定する。

> コア・アダプタとも OS 依存コード（パス区切り・シェル呼び出し等）は無いので、
> Windows / macOS / Linux で同じコードが動く。

## メッセージビルダー一覧

```ts
import {
  text, sticker, image, video, audio, location, imagemap, flex,
  buttonsTemplate, confirmTemplate, carouselTemplate, imageCarouselTemplate,
  // action
  postbackAction, messageAction, uriAction, datetimePickerAction,
  cameraAction, cameraRollAction, locationAction, richMenuSwitchAction, clipboardAction,
  // 付帯
  quickReply, qr, sender,
} from "open-line-reply";

text("こんにちは");
text("絵文字も可", { emojis: [{ index: 0, productId: "...", emojiId: "..." }] });
sticker("11537", "52002734");
image("https://.../full.jpg", "https://.../preview.jpg");
video("https://.../v.mp4", "https://.../thumb.jpg");
audio("https://.../a.m4a", 60000);
location({ title: "東京駅", address: "千代田区", latitude: 35.68, longitude: 139.76 });
flex("代替テキスト", { type: "bubble" /* ... */ });

buttonsTemplate({ text: "選んでください", actions: [postbackAction("a", "A"), uriAction("https://...", "開く")] });
confirmTemplate("よろしいですか？", [messageAction("はい"), messageAction("いいえ")]);
carouselTemplate([{ text: "商品1", actions: [postbackAction("buy=1", "買う")] }], "カルーセル");

// quickReply / sender はどのメッセージにも付けられる
text("どうぞ", {
  quickReply: quickReply(qr(messageAction("はい")), qr(postbackAction("no", "いいえ"))),
  sender: sender("サポート", "https://.../icon.png"),
});
```

## line-harness と繋ぐ

[line-harness](https://github.com/net-runners-com) (`@line-crm`) の `auto_replies`
テーブルを、この reply エンジンに載せるアダプタ (`open-line-reply/line-harness`)。
**push は使わない**ので、繋いでも無料枠は増えない = 減らない（line-harness の
シナリオ遅延・一斉配信は原理的に push のまま。無料化できるのは reply 可能な所だけ）。

> **自分の LINE 公式アカウントを繋ぐ手順**（インストール済みの PC で、コマンドを
> 貼るだけで完結するオンボーディング）は [ONBOARDING.ja.md](./ONBOARDING.ja.md) を参照。

### インストール

`apps/worker` のワークスペースに追加（pnpm monorepo）:

```bash
pnpm --filter worker add open-line-reply@github:net-runners-com/open-line-reply
```

### 最小の繋ぎ込み（既存 webhook の match ループを置換）

`apps/worker/src/routes/webhook.ts` の 2 つの auto_replies マッチループ
(postback / text) を `matchAutoReply` に置き換えるだけ。silent 判定・ログ・
replyToken 管理は既存のまま残せる（挙動維持）:

```ts
import { matchAutoReply, isSilent } from "open-line-reply/line-harness";

// autoReplies.results は既存の SELECT * FROM auto_replies ... の結果
const hit = matchAutoReply(incomingText, autoReplies.results);
if (hit) {
  if (isSilent(hit)) { matched = true; }
  else {
    const content = expandVariables(hit.response_content, friend, workerUrl);
    const msg = buildMessage(hit.response_type, content);
    await lineClient.replyMessage(event.replyToken, [msg]); // 無料
    // ...既存の messages_log INSERT / matched=true ...
  }
}
```

### 新規フローを宣言的に組む（router）

```ts
import { autoReplyRouter } from "open-line-reply/line-harness";

const router = autoReplyRouter(autoReplies.results, {
  build: (type, content) => buildMessage(type, expandVariables(content, friend, workerUrl)),
  onDefault: () => undefined, // マッチ無しは reply しない(=unread へ)
});
const messages = await router.dispatch(event as any); // @line-crm の event 形と互換
if (messages.length) await lineClient.replyMessage(event.replyToken, messages);
```

`matchAutoReply(input, rows)` は line-harness と同じ規則（exact=完全一致 /
contains=includes、行順で先頭勝ち、is_active=1 のみ）。`autoReplyRouter` は
contains を正規表現エスケープして安全に扱う。

## API

| export | 説明 |
|---|---|
| `createWebhookHandler(config)` | 生body+署名 → 検証 → 各イベントに reply。`config: { channelSecret, channelAccessToken, router, swallowErrors?, onError? }` |
| `cloudflareHandler(config)` | Workers の `fetch` ハンドラを返す（`open-line-reply/cloudflare`） |
| `nodeHandler(config)` / `listen(config, port)` | Node.js の `(req,res)` ハンドラ / サーバ起動（`open-line-reply/node`） |
| `matchAutoReply(input, rows)` / `autoReplyRouter(rows, opts)` | line-harness の `auto_replies` 連携（`open-line-reply/line-harness`） |
| `ReplyRouter` | `.onText` `.onPostback` `.onFollow` `.onJoin` `.onDefault` `.dispatch(event)` |
| `createReplyClient(token)` | `reply(replyToken, messages)` を返す低レベル関数 |
| `verifySignature(rawBody, signature, secret)` | 署名検証（Promise<boolean>） |
| メッセージ/action ビルダー | 上記一覧 |

ハンドラは `ReplyMessage`（単体 or 配列, 最大5件）を返す。何も返さなければその
イベントには reply しない（＝トークンを消費しない）。

## テスト

```bash
bun test
bun run typecheck
```

## ライセンス

MIT
