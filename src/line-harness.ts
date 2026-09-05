// line-harness アダプタ。
//
// line-harness(@line-crm) の `auto_replies` テーブルの行を、open-line-reply の
// マッチング/ルーターに載せるための薄いグルー。open-line-reply 本体は
// @line-crm に依存しない — ここだけが line-harness の行/メッセージ形を知っている。
//
// 使い分け:
//   - matchAutoReply(): 既存 webhook.ts の2つの match ループの最小置き換え(挙動維持)。
//     silent 判定・ログ・replyToken 管理は呼び出し側に残せる。
//   - autoReplyRouter(): 新規フローを ReplyRouter で宣言的に組むとき。
//
// どちらも「無料の reply でしか送らない」方針。push は扱わない。

import { ReplyRouter, type Handler, type ReplyMessage } from "./index";

// line-harness の auto_replies 行(必要フィールドだけ)。
export interface AutoReplyRow {
	keyword: string;
	match_type: "exact" | "contains";
	response_type: string; // "text" | "flex" | "image" | "silent" | ...
	response_content: string;
	is_active?: number | boolean;
	line_account_id?: string | null;
}

/** silent(返信しないが「対応済み」扱いにする)行かどうか */
export const isSilent = (row: AutoReplyRow): boolean => row.response_type === "silent";

const active = (row: AutoReplyRow): boolean =>
	row.is_active === undefined || row.is_active === 1 || row.is_active === true;

/**
 * 入力テキスト(または postback.data)に最初にマッチする auto_reply 行を返す。
 * line-harness と同じ規則: match_type==="exact" は完全一致、"contains" は includes。
 * 行の並び順(呼び出し側で created_at 順に用意)で先頭勝ち。
 * silent 行もそのまま返す(呼び出し側で response_type を見て分岐する)。
 */
export function matchAutoReply(input: string, rows: AutoReplyRow[]): AutoReplyRow | null {
	for (const row of rows) {
		if (!active(row)) continue;
		const hit = row.match_type === "exact" ? input === row.keyword : input.includes(row.keyword);
		if (hit) return row;
	}
	return null;
}

// 正規表現メタ文字のエスケープ(contains を RegExp 化するため)
const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export interface AutoReplyRouterOptions {
	/**
	 * 行 → 送信メッセージ の変換。line-harness では
	 * (type, content) => buildMessage(type, expandVariables(content, friend)) を渡す。
	 */
	build: (responseType: string, responseContent: string) => ReplyMessage;
	/** silent 行にマッチしたときのハンドラ(既定: 何も返さない=返信しない) */
	onSilent?: Handler;
	/** どの行にもマッチしなかったとき */
	onDefault?: Handler;
	/** follow イベントのハンドラ(任意) */
	onFollow?: Handler;
	/** テキストと postback の両方にルートを張るか(既定 true) */
	postback?: boolean;
}

/**
 * auto_replies 行から ReplyRouter を組み立てる。テキスト/ postback の両方にマッチする。
 * 行の順序で先頭勝ち。
 */
export function autoReplyRouter(rows: AutoReplyRow[], opts: AutoReplyRouterOptions): ReplyRouter {
	const router = new ReplyRouter();
	const usePostback = opts.postback ?? true;

	for (const row of rows) {
		if (!active(row)) continue;
		const handler: Handler = opts.onSilent && isSilent(row)
			? opts.onSilent
			: () => (isSilent(row) ? undefined : opts.build(row.response_type, row.response_content));
		const pattern = row.match_type === "exact" ? row.keyword : new RegExp(escapeRegExp(row.keyword));
		router.onText(pattern, handler);
		if (usePostback) router.onPostback(pattern, handler);
	}

	if (opts.onFollow) router.onFollow(opts.onFollow);
	if (opts.onDefault) router.onDefault(opts.onDefault);
	return router;
}
