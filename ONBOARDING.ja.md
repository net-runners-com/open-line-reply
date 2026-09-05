# オンボーディング（自分の LINE 公式アカウントを繋ぐ）

インストールした PC で、**コマンドを順に貼るだけ**で自分の LINE 公式アカウントに
「キーワード → 無料の自動返信（Flex 可）」を設定できる。ブラウザでのポチポチは不要
（LINE Developers でのトークン取得と Webhook URL 設定の2箇所だけ手作業）。

> 送るのは **reply（応答メッセージ）＝メッセージ通数を消費しない**。
> push / 一斉配信は枠を消費する（このオンボーディングでは使わない）。

---

## 0. 前提

- line-harness の worker がデプロイ済みで、その **URL** と **API キー** を持っている
  （自分でデプロイした人は `wrangler secret` の `API_KEY`、または env の値）。
- worker に `open-line-reply` が入っている（`pnpm --filter worker add open-line-reply@github:net-runners-com/open-line-reply`）。
- 手元に `curl` と `jq` がある（mac/Linux/WSL 標準。Windows は Git Bash か WSL 推奨）。

まず接続先をシェル変数に入れる（以降のコマンドで使い回す）:

```bash
export WORKER_URL="https://<あなたのworker>.workers.dev"   # 独自ドメインならそれ
export API_KEY="<あなたのAPIキー>"
```

---

## 1. LINE Developers でチャネル情報を取る（手作業・1回だけ）

[LINE Developers Console](https://developers.line.biz/console/) → 対象の
**Messaging API チャネル** で以下をコピー:

- **チャネルアクセストークン（長期）** … Messaging API 設定タブで発行
- **チャネルシークレット** … チャネル基本設定タブ
- **ボットのベーシックID**（`@xxxx`）または **チャネルID** … 識別名として使う

```bash
export CH_TOKEN="<channel access token>"
export CH_SECRET="<channel secret>"
export CH_ID="@xxxx"          # ベーシックID など、アカウントの識別子
export CH_NAME="マイ公式アカウント"
```

---

## 2. アカウントを登録する（コマンド）

```bash
ACCOUNT_ID=$(curl -s -X POST "$WORKER_URL/api/line-accounts" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d "$(jq -n --arg id "$CH_ID" --arg name "$CH_NAME" --arg tok "$CH_TOKEN" --arg sec "$CH_SECRET" \
        '{channelId:$id, name:$name, channelAccessToken:$tok, channelSecret:$sec}')" \
  | jq -r '.data.id')
echo "ACCOUNT_ID=$ACCOUNT_ID"
```

- `201` で `ACCOUNT_ID` が表示されれば成功。
- 既に登録済みの ID は `409 channelId already registered`（その場合は一覧から ID を引く）:
  ```bash
  curl -s "$WORKER_URL/api/line-accounts" -H "Authorization: Bearer $API_KEY" | jq '.data[] | {id, name, channel_id}'
  ```

---

## 3. キーワード → 自動返信を登録する（コマンド）

### テキスト返信

```bash
curl -s -X POST "$WORKER_URL/api/auto-replies" \
  -H "Authorization: Bearer $API_KEY" -H "Content-Type: application/json" \
  -d "$(jq -n --arg a "$ACCOUNT_ID" \
        '{keyword:"営業時間", matchType:"contains", responseType:"text",
          responseContent:"平日 10:00-18:00 です！", lineAccountId:$a}')"
```

### Flex 返信（見た目リッチ・無料）

```bash
FLEX='{"type":"bubble","body":{"type":"box","layout":"vertical","contents":[
  {"type":"text","text":"30分無料相談","weight":"bold","size":"xl"},
  {"type":"text","text":"お気軽にどうぞ","margin":"md","color":"#666666"}]},
  "footer":{"type":"box","layout":"vertical","contents":[
  {"type":"button","style":"primary","action":{"type":"uri","label":"予約する","uri":"https://example.com/booking"}}]}}'

curl -s -X POST "$WORKER_URL/api/auto-replies" \
  -H "Authorization: Bearer $API_KEY" -H "Content-Type: application/json" \
  -d "$(jq -n --arg a "$ACCOUNT_ID" --argjson flex "$FLEX" \
        '{keyword:"相談", matchType:"contains", responseType:"flex",
          responseContent:($flex|tostring), lineAccountId:$a}')"
```

- `matchType`: `contains`（部分一致）/ `exact`（完全一致）
- `responseType`: `text` / `flex` / `image` / `silent`（既読にするだけで返信しない）
- 登録済み一覧: `curl -s "$WORKER_URL/api/auto-replies" -H "Authorization: Bearer $API_KEY" | jq '.data'`

---

## 4. Webhook を向ける（手作業・1回だけ）

LINE Developers → Messaging API 設定:

1. **Webhook URL** に `${WORKER_URL}/webhook` を設定 → 「検証」で 200 を確認
2. **Webhook の利用** を ON

LINE Official Account Manager → 設定 → 応答設定（3つは独立）:

| 設定 | 推奨 | 理由 |
|---|---|---|
| 応答モード | **チャットのまま**（Bot に変えない） | 運用者チャット（chat.line.biz / OA Manager アプリ）を使い続けるため。Bot に変えると運用者チャットが使えなくなる |
| Webhook | **ON** | line-harness の無料 reply はここ経由。チャットモードでも ON にできる |
| 応答メッセージ | **OFF** | LINE 内蔵の定型自動応答を止めるだけ。ON のままだと Webhook 返信と**二重返信**になる |

> **注意**: 「応答メッセージ OFF」は内蔵の定型返信を止めるだけで、運用者チャットや
> Webhook 返信は止まらない。**応答モードは「チャット」のまま**にすること
> （Bot に切り替えると chat.line.biz 経由の運用者チャットが `not_chat_mode_bot` で
> 使えなくなる）。チャットモード＋Webhook ON は共存できる。

複数アカウントでも Webhook URL は全員同じ `${WORKER_URL}/webhook` で OK。
worker が署名でアカウントを自動判別する。

---

## 5. テスト

1. 自分のスマホで対象の公式アカウントを友だち追加
2. 登録したキーワード（例「相談」）を送る
3. 無料の reply で Flex が返ってくれば成功

うまく返らないときのチェック:

```bash
# 登録内容の確認
curl -s "$WORKER_URL/api/auto-replies" -H "Authorization: Bearer $API_KEY" | jq '.data[] | {keyword, match_type, response_type, line_account_id}'
# worker ログ（デプロイ元で）
wrangler tail
```

- Webhook URL の「検証」が 200 か（署名 = 登録した channelSecret と一致しているか）
- 応答メッセージが OFF になっているか（ON だと Webhook 返信が出ないことがある）

---

## 何が無料 / 何が課金か

**「無料 = replyToken が要る」ではない。** 無料経路は2つあり、性質が違う:

| 無料経路 | replyToken | いつ送れる | 相手 | このパッケージ |
|---|---|---|---|---|
| Messaging API の **reply（応答）** | **必要**（1イベント1個・約1分・使い切り・最大5通） | 相手のアクション直後のみ（受け身） | イベントを起こした本人 | ○ open-line-reply |
| chat.line.biz の **運用者送信** | **不要** | **いつでも**（能動的に） | 過去に OA へ話しかけてきた人 | 別ツール（`chatbiz.ts`。Cookie 直叩き） |

課金されるのは **push / 一斉配信 / 時間差ステップ配信**（月200通〜、超過は従量）だけ。

- このオンボーディングで作る auto-reply は **reply 経路**（replyToken 依存・受け身）
- 「会話がある人へ、好きなタイミングで無料」で送りたいなら **chat.line.biz 経路**（replyToken 不要）。ただし沈黙フォロワーには送れない
- 沈黙フォロワーへ能動的に送るのは push（枠消費）しか無い

つまり「無料で送る」には ①相手のアクションに reply（このパッケージ）と、②会話がある人へ運用者送信（chatbiz、replyToken 不要）の2通りがある。**②は replyToken に依存しない。**
