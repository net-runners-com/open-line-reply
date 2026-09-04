// LINE Messaging API で送れる全メッセージタイプのビルダー。
// reply / push どちらでも使える形(公式 Message オブジェクト)を返す。
//
// 対応タイプ: text / textV2 / sticker / image / video / audio / location /
//            imagemap / template(buttons,confirm,carousel,imageCarousel) / flex
// 付帯: quickReply / sender / action 各種

// ---------------------------------------------------------------------------
// action(ボタン・クイックリプライ・imagemap・template で使う)
// ---------------------------------------------------------------------------

export interface PostbackAction {
	type: "postback";
	label?: string;
	data: string;
	displayText?: string;
	inputOption?: "closeRichMenu" | "openRichMenu" | "openKeyboard" | "openVoice";
	fillInText?: string;
}
export interface MessageAction {
	type: "message";
	label?: string;
	text: string;
}
export interface UriAction {
	type: "uri";
	label?: string;
	uri: string;
	altUri?: { desktop: string };
}
export interface DatetimePickerAction {
	type: "datetimepicker";
	label?: string;
	data: string;
	mode: "date" | "time" | "datetime";
	initial?: string;
	max?: string;
	min?: string;
}
export interface CameraAction { type: "camera"; label: string }
export interface CameraRollAction { type: "cameraRoll"; label: string }
export interface LocationAction { type: "location"; label: string }
export interface RichMenuSwitchAction {
	type: "richmenuswitch";
	label?: string;
	richMenuAliasId: string;
	data: string;
}
export interface ClipboardAction {
	type: "clipboard";
	label?: string;
	clipboardText: string;
}

export type Action =
	| PostbackAction
	| MessageAction
	| UriAction
	| DatetimePickerAction
	| CameraAction
	| CameraRollAction
	| LocationAction
	| RichMenuSwitchAction
	| ClipboardAction;

export const postbackAction = (
	data: string,
	label?: string,
	opts: Partial<Omit<PostbackAction, "type" | "data" | "label">> = {},
): PostbackAction => ({ type: "postback", data, ...(label ? { label } : {}), ...opts });

export const messageAction = (text: string, label?: string): MessageAction => ({
	type: "message",
	text,
	...(label ? { label } : {}),
});

export const uriAction = (uri: string, label?: string, altDesktopUri?: string): UriAction => ({
	type: "uri",
	uri,
	...(label ? { label } : {}),
	...(altDesktopUri ? { altUri: { desktop: altDesktopUri } } : {}),
});

export const datetimePickerAction = (
	data: string,
	mode: DatetimePickerAction["mode"],
	label?: string,
	opts: Partial<Pick<DatetimePickerAction, "initial" | "max" | "min">> = {},
): DatetimePickerAction => ({ type: "datetimepicker", data, mode, ...(label ? { label } : {}), ...opts });

export const cameraAction = (label: string): CameraAction => ({ type: "camera", label });
export const cameraRollAction = (label: string): CameraRollAction => ({ type: "cameraRoll", label });
export const locationAction = (label: string): LocationAction => ({ type: "location", label });
export const richMenuSwitchAction = (richMenuAliasId: string, data: string, label?: string): RichMenuSwitchAction => ({
	type: "richmenuswitch",
	richMenuAliasId,
	data,
	...(label ? { label } : {}),
});
export const clipboardAction = (clipboardText: string, label?: string): ClipboardAction => ({
	type: "clipboard",
	clipboardText,
	...(label ? { label } : {}),
});

// ---------------------------------------------------------------------------
// quickReply / sender(全メッセージ共通の付帯オプション)
// ---------------------------------------------------------------------------

export interface QuickReplyItem {
	type: "action";
	imageUrl?: string;
	action: Action;
}
export interface QuickReply {
	items: QuickReplyItem[];
}
export interface Sender {
	name?: string;
	iconUrl?: string;
}

/** action(と任意のアイコン)から quickReply アイテムを作る */
export const qr = (action: Action, imageUrl?: string): QuickReplyItem => ({
	type: "action",
	action,
	...(imageUrl ? { imageUrl } : {}),
});

/** quickReply オブジェクトを作る */
export const quickReply = (...items: QuickReplyItem[]): QuickReply => ({ items });

export const sender = (name?: string, iconUrl?: string): Sender => ({
	...(name ? { name } : {}),
	...(iconUrl ? { iconUrl } : {}),
});

/** 全メッセージに付けられる共通オプション */
export interface MessageOptions {
	quickReply?: QuickReply;
	sender?: Sender;
}

function withOpts<T extends object>(base: T, opts: MessageOptions = {}): T & MessageOptions {
	return {
		...base,
		...(opts.quickReply ? { quickReply: opts.quickReply } : {}),
		...(opts.sender ? { sender: opts.sender } : {}),
	};
}

// ---------------------------------------------------------------------------
// メッセージ本体
// ---------------------------------------------------------------------------

export interface TextMessage extends MessageOptions {
	type: "text";
	text: string;
	quoteToken?: string;
	emojis?: Array<{ index: number; productId: string; emojiId: string }>;
}
export interface StickerMessage extends MessageOptions {
	type: "sticker";
	packageId: string;
	stickerId: string;
	quoteToken?: string;
}
export interface ImageMessage extends MessageOptions {
	type: "image";
	originalContentUrl: string;
	previewImageUrl: string;
}
export interface VideoMessage extends MessageOptions {
	type: "video";
	originalContentUrl: string;
	previewImageUrl: string;
	trackingId?: string;
}
export interface AudioMessage extends MessageOptions {
	type: "audio";
	originalContentUrl: string;
	duration: number; // ミリ秒
}
export interface LocationMessage extends MessageOptions {
	type: "location";
	title: string;
	address: string;
	latitude: number;
	longitude: number;
}
export interface ImagemapMessage extends MessageOptions {
	type: "imagemap";
	baseUrl: string;
	altText: string;
	baseSize: { width: number; height: number };
	actions: unknown[];
	video?: unknown;
}
export interface TemplateMessage extends MessageOptions {
	type: "template";
	altText: string;
	template: unknown;
}
export interface FlexMessage extends MessageOptions {
	type: "flex";
	altText: string;
	contents: unknown;
}

export type ReplyMessage =
	| TextMessage
	| StickerMessage
	| ImageMessage
	| VideoMessage
	| AudioMessage
	| LocationMessage
	| ImagemapMessage
	| TemplateMessage
	| FlexMessage
	| Record<string, unknown>; // その他/将来のタイプのエスケープハッチ

// --- ビルダー ---

export const text = (
	t: string,
	opts: MessageOptions & { quoteToken?: string; emojis?: TextMessage["emojis"] } = {},
): TextMessage => {
	const { quoteToken, emojis, ...mo } = opts;
	return withOpts(
		{ type: "text" as const, text: t, ...(quoteToken ? { quoteToken } : {}), ...(emojis ? { emojis } : {}) },
		mo,
	);
};

export const sticker = (
	packageId: string,
	stickerId: string,
	opts: MessageOptions & { quoteToken?: string } = {},
): StickerMessage => {
	const { quoteToken, ...mo } = opts;
	return withOpts(
		{ type: "sticker" as const, packageId, stickerId, ...(quoteToken ? { quoteToken } : {}) },
		mo,
	);
};

export const image = (
	originalContentUrl: string,
	previewImageUrl = originalContentUrl,
	opts: MessageOptions = {},
): ImageMessage => withOpts({ type: "image" as const, originalContentUrl, previewImageUrl }, opts);

export const video = (
	originalContentUrl: string,
	previewImageUrl: string,
	opts: MessageOptions & { trackingId?: string } = {},
): VideoMessage => {
	const { trackingId, ...mo } = opts;
	return withOpts(
		{ type: "video" as const, originalContentUrl, previewImageUrl, ...(trackingId ? { trackingId } : {}) },
		mo,
	);
};

export const audio = (
	originalContentUrl: string,
	duration: number,
	opts: MessageOptions = {},
): AudioMessage => withOpts({ type: "audio" as const, originalContentUrl, duration }, opts);

export const location = (
	args: { title: string; address: string; latitude: number; longitude: number },
	opts: MessageOptions = {},
): LocationMessage => withOpts({ type: "location" as const, ...args }, opts);

export const imagemap = (
	args: { baseUrl: string; altText: string; baseSize: { width: number; height: number }; actions: unknown[]; video?: unknown },
	opts: MessageOptions = {},
): ImagemapMessage => withOpts({ type: "imagemap" as const, ...args }, opts);

export const flex = (altText: string, contents: unknown, opts: MessageOptions = {}): FlexMessage =>
	withOpts({ type: "flex" as const, altText, contents }, opts);

// --- template メッセージ(4 種) ---

export const templateMessage = (altText: string, template: unknown, opts: MessageOptions = {}): TemplateMessage =>
	withOpts({ type: "template" as const, altText, template }, opts);

export const buttonsTemplate = (
	args: { text: string; actions: Action[]; title?: string; thumbnailImageUrl?: string; defaultAction?: Action; imageAspectRatio?: "rectangle" | "square"; imageSize?: "cover" | "contain"; imageBackgroundColor?: string },
	altText = args.text,
	opts: MessageOptions = {},
): TemplateMessage =>
	templateMessage(altText, {
		type: "buttons",
		text: args.text,
		actions: args.actions,
		...(args.title ? { title: args.title } : {}),
		...(args.thumbnailImageUrl ? { thumbnailImageUrl: args.thumbnailImageUrl } : {}),
		...(args.defaultAction ? { defaultAction: args.defaultAction } : {}),
		...(args.imageAspectRatio ? { imageAspectRatio: args.imageAspectRatio } : {}),
		...(args.imageSize ? { imageSize: args.imageSize } : {}),
		...(args.imageBackgroundColor ? { imageBackgroundColor: args.imageBackgroundColor } : {}),
	}, opts);

export const confirmTemplate = (
	text: string,
	actions: [Action, Action],
	altText = text,
	opts: MessageOptions = {},
): TemplateMessage => templateMessage(altText, { type: "confirm", text, actions }, opts);

export interface CarouselColumn {
	text: string;
	actions: Action[];
	title?: string;
	thumbnailImageUrl?: string;
	imageBackgroundColor?: string;
	defaultAction?: Action;
}
export const carouselTemplate = (
	columns: CarouselColumn[],
	altText: string,
	opts: MessageOptions & { imageAspectRatio?: "rectangle" | "square"; imageSize?: "cover" | "contain" } = {},
): TemplateMessage => {
	const { imageAspectRatio, imageSize, ...mo } = opts;
	return templateMessage(altText, {
		type: "carousel",
		columns,
		...(imageAspectRatio ? { imageAspectRatio } : {}),
		...(imageSize ? { imageSize } : {}),
	}, mo);
};

export interface ImageCarouselColumn {
	imageUrl: string;
	action: Action;
}
export const imageCarouselTemplate = (
	columns: ImageCarouselColumn[],
	altText: string,
	opts: MessageOptions = {},
): TemplateMessage => templateMessage(altText, { type: "image_carousel", columns }, opts);
