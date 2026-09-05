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
3. LINE Official Account Manager → 応答設定で **応答メッセージを OFF / Webhook を ON**
   （自動応答が Webhook を上書きしないように）

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

| 操作 | 枠 |
|---|---|
| キーワード / postback / 友だち追加への **返信（reply）** | **無料** |
| 一斉配信・push・時間差ステップ配信 | 消費（月200通〜、超過は従量） |

このオンボーディングで作るのは全部 reply なので、**通数は消費しない**。
時間差の配信をしたい場合だけ、別途 push（枠消費）が必要。
