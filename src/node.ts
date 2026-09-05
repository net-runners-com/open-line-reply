// Node.js アダプタ(Windows / macOS / Linux 共通)。
// Bun や Cloudflare を使わず、素の Node.js で webhook サーバを立てるための口。
// Node 20+ 推奨(Web Crypto と fetch と btoa がグローバルに揃う)。
// Node 18 の場合は globalThis.crypto が無いことがあるので下でフォールバックする。
//
//   import { listen, ReplyRouter, text } from "open-line-reply/node";
//   const router = new ReplyRouter().onText("hi", () => text("hello"));
//   listen({ router,
//     channelSecret: process.env.LINE_CHANNEL_SECRET!,
//     channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN! }, 3000);

import { createWebhookHandler, ReplyRouter } from "./index";

export * from "./index";

// Node 18 で globalThis.crypto が未定義なら node:crypto の webcrypto を載せる。
// (副作用のため node.ts を import した時点で一度だけ実行)
if (typeof (globalThis as { crypto?: unknown }).crypto === "undefined") {
	try {
		// 動的 import: Workers/Deno バンドルには含めない
		const nodeCrypto = await import("node:crypto");
		(globalThis as { crypto?: unknown }).crypto = (nodeCrypto as { webcrypto?: unknown }).webcrypto;
	} catch {
		/* Web Crypto が本当に無い環境ではここで諦める(verifySignature が失敗する) */
	}
}

// @types/node に依存しないための最小構造型
interface NodeReq {
	method?: string;
	url?: string;
	headers: Record<string, string | string[] | undefined>;
	on(event: "data", cb: (chunk: Buffer | string) => void): void;
	on(event: "end", cb: () => void): void;
	on(event: "error", cb: (err: unknown) => void): void;
}
interface NodeRes {
	statusCode: number;
	setHeader(name: string, value: string): void;
	end(body?: string): void;
}

export interface NodeConfig {
	router: ReplyRouter;
	channelSecret: string;
	channelAccessToken: string;
	/** webhook を受ける path(既定 "/webhook"。"*" で全 path 許可) */
	path?: string;
	swallowErrors?: boolean;
	onError?: (err: unknown) => void;
}

function readBody(req: NodeReq): Promise<string> {
	return new Promise((resolve, reject) => {
		const chunks: string[] = [];
		req.on("data", (c) => chunks.push(typeof c === "string" ? c : c.toString("utf8")));
		req.on("end", () => resolve(chunks.join("")));
		req.on("error", reject);
	});
}

/** node:http / express 互換の (req, res) ハンドラを返す */
export function nodeHandler(config: NodeConfig) {
	const path = config.path ?? "/webhook";
	const handle = createWebhookHandler({
		router: config.router,
		channelSecret: config.channelSecret,
		channelAccessToken: config.channelAccessToken,
		swallowErrors: config.swallowErrors,
		onError: config.onError,
	});
	return async function requestHandler(req: NodeReq, res: NodeRes): Promise<void> {
		const pathname = (req.url ?? "/").split("?")[0];
		if (req.method !== "POST" || (path !== "*" && pathname !== path)) {
			res.statusCode = 404;
			res.end("Not Found");
			return;
		}
		const rawBody = await readBody(req);
		const result = await handle(rawBody, (req.headers["x-line-signature"] as string) ?? null);
		if (result.status === 401) {
			res.statusCode = 401;
			res.end("invalid signature");
			return;
		}
		res.statusCode = 200;
		res.end("OK");
	};
}

/** node:http でサーバを立てて listen する簡易ヘルパー */
export async function listen(
	config: NodeConfig,
	port = 3000,
	host = "0.0.0.0",
): Promise<{ close: () => void }> {
	const http = await import("node:http");
	const handler = nodeHandler(config);
	const server = http.createServer((req, res) =>
		handler(req as unknown as NodeReq, res as unknown as NodeRes),
	);
	await new Promise<void>((resolve) => server.listen(port, host, resolve));
	console.log(`[open-line-reply] listening on http://${host}:${port}${config.path ?? "/webhook"}`);
	return { close: () => server.close() };
}
