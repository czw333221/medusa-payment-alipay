export interface AlipayOptions {
  appId: string;
  privateKey: string;
  alipayPublicKey: string;
  capture?: boolean;
  notifyUrl: string;
}

export type AlipayOrder = {
  trade_status: keyof typeof AlipayOrderStatus;
  out_trade_no: string;
};


export interface RefundPayment {
  value: string | number
  currency_code: string
}

export const AlipayOrderStatus = {
  // 交易关闭
  TRADE_CLOSED: "TRADE_CLOSED",
  // 交易结束，不可退款
  TRADE_FINISHED: "TRADE_FINISHED",
  // 支付成功
  TRADE_SUCCESS: "TRADE_SUCCESS",
  // 交易创建
  WAIT_BUYER_PAY: "WAIT_BUYER_PAY",
};
