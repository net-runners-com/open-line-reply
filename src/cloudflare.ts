// Cloudflare Workers 用アダプタ。
// createWebhookHandler を fetch ハンドラでラップするだけ。
//
//   import { cloudflareHandler, ReplyRouter, text } from "open-line-reply/cloudflare";
//   const router = new ReplyRouter().onText("hi", () => text("hello"));
//   export default { fetch: cloudflareHandler({ router,
//     channelSecret: (env)=>env.LINE_CHANNEL_SECRET,
//     channelAccessToken: (env)=>env.LINE_CHANNEL_ACCESS_TOKEN }) };

import { createWebhookHandler, ReplyRouter } from "./index";

export * from "./index";

export interface CloudflareConfig {
	router: ReplyRouter;
	/** env から channel secret を取り出す(または固定文字列) */
	channelSecret: string | ((env: Record<string, unknown>) => string);
	/** env から channel access token を取り出す(または固定文字列) */
	channelAccessToken: string | ((env: Record<string, unknown>) => string);
	/** webhook を受ける path(既定 "/webhook"。"*" で全 path 許可) */
	path?: string;
	swallowErrors?: boolean;
	onError?: (err: unknown) => void;
}

const resolve = (v: string | ((e: Record<string, unknown>) => string), env: Record<string, unknown>) =>
	typeof v === "function" ? v(env) : v;

export function cloudflareHandler(config: CloudflareConfig) {
	const path = config.path ?? "/webhook";
	return async function fetch(request: Request, env: Record<string, unknown>): Promise<Response> {
		const url = new URL(request.url);
		if (request.method !== "POST" || (path !== "*" && url.pathname !== path)) {
			return new Response("Not Found", { status: 404 });
		}
		const handle = createWebhookHandler({
			router: config.router,
			channelSecret: resolve(config.channelSecret, env),
			channelAccessToken: resolve(config.channelAccessToken, env),
			swallowErrors: config.swallowErrors,
			onError: config.onError,
		});
		const rawBody = await request.text();
		const result = await handle(rawBody, request.headers.get("x-line-signature"));
		// LINE には常に 200 を返すのが無難(再送ループ回避)。署名不正のみ 401。
		if (result.status === 401) return new Response("invalid signature", { status: 401 });
		return new Response("OK", { status: 200 });
	};
}
