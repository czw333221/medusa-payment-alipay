"use server";
import { EOL } from "os";
import {
  AbstractPaymentProcessor,
  isPaymentProcessorError,
  PaymentProcessorContext,
  PaymentProcessorError,
  PaymentProcessorSessionResponse,
  PaymentSessionStatus,
} from "@medusajs/medusa";
import { MedusaError } from "@medusajs/utils";
import { AlipayOptions, AlipayOrder, AlipayOrderStatus } from "../types";
import AlipaySdk from "alipay-sdk";

class AlipayProviderService extends AbstractPaymentProcessor {
  static identifier = "alipay";

  protected readonly options_: AlipayOptions;
  protected alipay_: AlipaySdk;
  protected updateStatus_: boolean;
  protected notifyUrl_: string;

  constructor(_, options: AlipayOptions) {
    // @ts-ignore
    // eslint-disable-next-line prefer-rest-params
    super(...arguments);

    this.options_ = options;
    this.init();
  }

  protected init(): void {
    this.alipay_ = new AlipaySdk({
      appId: this.options_.appId,
      privateKey: this.options_.privateKey,
      alipayPublicKey: this.options_.alipayPublicKey,
      gateway: "https://openapi-sandbox.dl.alipaydev.com/gateway.do",
    });
    if (this.options_.notifyUrl) {
      this.notifyUrl_ = this.options_.notifyUrl;
    }
  }

  async getPaymentStatus(
    paymentSessionData: Record<string, unknown>
  ): Promise<PaymentSessionStatus> {
    const order = (await this.retrievePayment(
      paymentSessionData
    )) as AlipayOrder;
    console.log("getPaymentStatus", order);
    switch (order.trade_status) {
      case AlipayOrderStatus.WAIT_BUYER_PAY:
        return PaymentSessionStatus.PENDING;
      case AlipayOrderStatus.TRADE_CLOSED:
        return PaymentSessionStatus.CANCELED;
      case AlipayOrderStatus.TRADE_SUCCESS:
      case AlipayOrderStatus.TRADE_FINISHED:
        return PaymentSessionStatus.AUTHORIZED;
      default:
        return PaymentSessionStatus.PENDING;
    }
  }

  async initiatePayment(
    contexts: PaymentProcessorContext
  ): Promise<PaymentProcessorError | PaymentProcessorSessionResponse> {
    const { amount, resource_id } = contexts;
    let session_data: Record<string, unknown> = {
      id: resource_id,
    };
    const total_amount = (amount / 100).toFixed(2);
    try {
      session_data["url"] = await this.alipay_.pageExec(
        "alipay.trade.page.pay",
        {
          method: "GET",
          notify_url: this.notifyUrl_,
          bizContent: {
            out_trade_no: resource_id,
            subject: "零壹道",
            product_code: "FAST_INSTANT_TRADE_PAY",
            total_amount: total_amount,
          },
        }
      );
      console.log("initiatePayment", session_data);
    } catch (e) {
      return this.buildError("initiatePayment中出现错误", e);
    }
    return {
      session_data,
    };
  }

  async authorizePayment(
    paymentSessionData: Record<string, unknown>,
    context: Record<string, unknown>
  ): Promise<
    | PaymentProcessorError
    | {
        status: PaymentSessionStatus;
        data: PaymentProcessorSessionResponse["session_data"];
      }
  > {
    try {
      const status = await this.getPaymentStatus(paymentSessionData);
      const order = (await this.retrievePayment(
        paymentSessionData
      )) as AlipayOrder;
      return { data: order, status: status };
    } catch (error) {
      return this.buildError("authorizePayment 出现错误", error);
    }
  }

  async cancelPayment(
    paymentSessionData: Record<string, unknown>
  ): Promise<
    PaymentProcessorError | PaymentProcessorSessionResponse["session_data"]
  > {
    try {
      const out_trade_no = paymentSessionData["id"];
      return await this.alipay_.exec("alipay.trade.close", {
        bizContent: { out_trade_no: out_trade_no },
      });
    } catch (error) {
      return this.buildError("cancelPayment 出现错误", error);
    }
  }

  async capturePayment(
    paymentSessionData: Record<string, unknown>
  ): Promise<
    PaymentProcessorError | PaymentProcessorSessionResponse["session_data"]
  > {
    try {
      return await this.retrievePayment(paymentSessionData);
    } catch (error) {
      return this.buildError("capturePayment 出现错误", error);
    }
  }

  /**
   * Alipay does not provide such feature
   * @param paymentSessionData
   */
  async deletePayment(
    paymentSessionData: Record<string, unknown>
  ): Promise<
    PaymentProcessorError | PaymentProcessorSessionResponse["session_data"]
  > {
    return await this.cancelPayment(paymentSessionData);
  }

  async refundPayment(
    paymentSessionData: Record<string, unknown>,
    refundAmount: number
  ): Promise<
    PaymentProcessorError | PaymentProcessorSessionResponse["session_data"]
  > {
    const out_trade_no = paymentSessionData["id"];

    try {
      await this.alipay_.pageExec("alipay.trade.refund", {
        bizContent: {
          out_trade_no: out_trade_no,
          refund_amount: refundAmount,
        },
      });
      return await this.retrievePayment(paymentSessionData);
    } catch (error) {
      return this.buildError("refundPayment 出现错误", error);
    }
  }

  async retrievePayment(
    paymentSessionData: Record<string, unknown>
  ): Promise<
    PaymentProcessorError | PaymentProcessorSessionResponse["session_data"]
  > {
    try {
      const out_trade_no = paymentSessionData["id"];
      const responsive = await this.alipay_.exec("alipay.trade.query", {
        bizContent: {
          out_trade_no: out_trade_no,
        },
      });
      console.log("retrievePayment", responsive);
      return responsive as unknown as PaymentProcessorSessionResponse["session_data"];
    } catch (e) {
      return this.buildError("retrievePayment 出现错误", e);
    }
  }

  async updatePayment(
    context: PaymentProcessorContext
  ): Promise<PaymentProcessorError | PaymentProcessorSessionResponse | void> {
    const { amount, customer, paymentSessionData } = context;
    const stripeId = customer?.metadata?.stripe_id;
    if (
      stripeId !== paymentSessionData.customer ||
      (amount && paymentSessionData.total_amount !== amount)
    ) {
      this.updateStatus_ = true;

      try {
        const result = await this.initiatePayment(context);
        if (isPaymentProcessorError(result)) {
          return this.buildError(
            "An error occurred in updatePayment during the initiate of the new payment for the new customer",
            result
          );
        }
        return result;
      } catch (error) {
        return this.buildError("An error occurred in updatePayment", error);
      } finally {
        // 确保更新状态无论成功或失败都执行
        this.updateStatus_ = false; // 如果update完成后需要重置状态，则改为false；如果表示正在进行中则保持为true
      }
    } else {
      return; // 如果无需更新，则直接返回
    }
  }

  async updatePaymentData(sessionId: string, data: Record<string, unknown>) {
    try {
      // Prevent from updating the amount from here as it should go through
      // the updatePayment method to perform the correct logic
      if (data.amount) {
        throw new MedusaError(
          MedusaError.Types.INVALID_DATA,
          "Cannot update amount, use updatePayment instead"
        );
      }

      return data;
    } catch (e) {
      return this.buildError("An error occurred in updatePaymentData", e);
    }
  }

  protected buildError(
    message: string,
    e: PaymentProcessorError | Error
  ): PaymentProcessorError {
    return {
      error: message,
      code: "code" in e ? e.code : "",
      detail: isPaymentProcessorError(e)
        ? `${e.error}${EOL}${e.detail ?? ""}`
        : e.message ?? "",
    };
  }
  async verifyAlipayNotify(data) {
    // true | false

    return this.alipay_.checkNotifySign(data);
  }
}

export default AlipayProviderService;
