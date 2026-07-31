import type { KeywordReplyRule, ReplyTemplateMap } from "./types";

export const REPLY_TEMPLATE_STORAGE_KEY = "xianyuReplyMessageTemplates";
export const KEYWORD_RULE_STORAGE_KEY = "xianyuKeywordReplyRules";
export const TEXT_FALLBACK_STORAGE_KEY = "xianyuAutoReplyTextFallback";
export const AUTO_REPLY_STORAGE_KEY = "autoReply";
export const DELIVER_SEND_IMAGE_STORAGE_KEY = "xianyuDeliverSendImageEnabled";

export const DEFAULT_REPLY_TEMPLATES: ReplyTemplateMap = {
  identify_wait: "正查询价哦，默认按最下方《购票信息》出票，请核对后再拍，严禁连下两单，须上单出票或退款后再下新单，否则出错责任自负嗷~",
  identify_fail: "你好，请截图清晰的选座截图哦亲",
  quote_exceeds: "您现在用的APP有合适的优惠价，可以自行购买。",
  identify_success:
    "《购票信息》\n[城市]-[影院地址]\n[影院名]-[影厅名]\n[影片名]-[放映时间]\n[座位信息]\n[单座位报价]元/张-合计[整单报价]元\n--------------------------------\n城市、影院、座位数易识别错误，请核对与您的截图是否一致。如识别错误，请赶紧咨询其他商家！如果确认无误可拍下不用付款，等我这边改完价格后再付款哦",
  edit_price_success:
    "已改好价格，请再次核对上方《购票信息》，包括是不是[城市]的[影院名]等内容，确认无误再付款！\n特别提醒： 少数买家未认真阅读《购票须知》1、2内容，导致在退票、座位问题上产生纠纷，请看清楚后再付款。",
  payment_successful:
    "系统已下单，10-50分钟自动将影院取票码发这里，请耐心等待；如出票失败也会立刻退款。\n严禁连下两单，须上单出票或退款后再下新单，否则出错责任自负。",
  duplicate_order_blocked:
    "亲，同一会话严禁连下两单。请先等待上一单出票或退款完成后，再重新拍下一单；当前这单先不要付款哦。",
  no_quote_record: "未找到报价记录，请先发送电影选座截图，我来报价哦",
  quote_blacklisted: "当前场次命中报价黑名单，暂不提供自动报价，请更换场次或联系人工客服。",
  show_time_too_short: "你好，开场时间小于40分钟，请选择其他场次哦",
  cancel_ticket: "很抱歉，因影院订票接口网络忙或特惠票通道关闭，将自动退款，以下消息请忽略",
  text_message_replay:
    "购票流程:\n    1. 发具体选座完整截图。\n    2. 稍等几秒钟，我给你报优惠价格。\n    3. 价格合适再点购买拍下后改价再付款。\n    4. 下单付款，客服出票并发【取票码】给你\n    5. 凭【取票码】在影院自助取票机或前台取票即可",
  send_ticket_success:
    "已出票成功，如自助机无法扫码出票，请输入取票码:[取票码],取票；\n如还不行，请联系前台工作人员取票并打开手机录音；\n如工作人员告知你无法出票，请将该段对话内容录音保存（尽量包含场次信息等），凭录音申请退款。\n请不要擅自在影院退票，否则后果自负！",
  ticket_failed_replay:
    "系统报价过低渠道出票失败，我已帮您重新调整价格，本次出票率到达99%，如果需要可以直接付款，无需再发图报价，等我这边改完价格后再付款哦\n  《购票信息》\n[城市]-[影院地址]\n[影院名]-[影厅名]\n[影片名]-[放映时间]\n[座位信息]\n[单座位报价]元/张-合计[整单报价]元\n--------------------------------\n城市、影院、座位数易识别错误，请核对与您的截图是否一致。如识别错误，请赶紧咨询其他商家！如果确认无误可拍下不用付款，等我这边改完价格后再付款哦"
};

export const DEFAULT_KEYWORD_REPLY_RULES: KeywordReplyRule[] = [
  {
    id: "default-greeting",
    enabled: true,
    keywords: ["你好", "您好", "在吗", "怎么买", "有吗", "票价多少", "多少钱", "便宜多少", "什么价", "dd", "滴滴", "多少呢", "哈喽", "在么", "随买随用吗？", "能看吗", "怎么拍", "9.9"],
    priority: 2,
    reply: "您可以发选座截图给我，让我给你报价哦"
  },
  {
    id: "default-confirm",
    enabled: true,
    keywords: ["好的", "可以", "确认", "就是这个", "怎么拍", "就这个吧", "对的", "信息正确", "没错", "改价", "链接"],
    priority: 2,
    reply: "如果确认好购票信息，直接拍下不要付款等我改价后付款哦"
  },
  {
    id: "default-ticketing-time",
    enabled: true,
    keywords: ["好了吗", "还没好吗", "还要多久", "还没出吗", "还没出票", "多久出票", "出票了吗", "尽快出票", "多久能出票"],
    priority: 3,
    reply: "正常出票时间是10-50分钟，凌晨出票时间延长到早上9点后哦，部分电影可能会稍微久一点哦"
  },
  {
    id: "default-discount",
    enabled: true,
    keywords: ["便宜一点", "还能便宜", "能便宜", "还有优惠"],
    priority: 10,
    reply: "系统自动报价，没法人工干预价格，太便宜了系统出票率会更低哦"
  },
  {
    id: "default-how-to-order",
    enabled: true,
    keywords: ["怎么下单", "直接付款吗"],
    priority: 10,
    reply: "系统报价后直接拍下不要付款哦，等我改价再付款就行了"
  },
  {
    id: "default-ship-now",
    enabled: true,
    keywords: ["及时发货"],
    priority: 1,
    reply: "已经在出票中了哦"
  },
  {
    id: "default-complete",
    enabled: true,
    keywords: ["交易成功", "确认收货"],
    priority: 1,
    reply: "感谢支持，能否点个关注防走丢，后面还有更多优惠电影哦"
  },
  {
    id: "default-can-buy",
    enabled: true,
    keywords: ["能买吗"],
    priority: 1,
    reply: "可以的哦"
  },
  {
    id: "default-thanks",
    enabled: true,
    keywords: ["谢谢"],
    priority: 1,
    reply: "不客气的亲，要买票还来找我哦"
  },
  {
    id: "default-seat-mismatch",
    enabled: true,
    keywords: ["座位不对", "座位少了", "位置不对"],
    priority: 5,
    reply: "如果出现座位过多，系统识别不全请分多次下单哈"
  },
  {
    id: "default-where-seat",
    enabled: true,
    keywords: ["哪里选座"],
    priority: 10,
    reply: "美团或者淘票票app"
  }
];
