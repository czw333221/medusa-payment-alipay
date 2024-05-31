import type { MedusaRequest, MedusaResponse } from "@medusajs/medusa";
import { getEventEmitter } from "../events/eventEmitterModule";


export const GET = (req: MedusaRequest, res: MedusaResponse) => {
  const eventEmitter = getEventEmitter();
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("Transfer-Encoding", "chunked");

  let retryAttempts = 0;

  function sendPaymentstate (out_trade_no: string) {
    if (retryAttempts >= 3) {
      console.warn(
        `Failed to send payment state  event after ${3} attempts`
      );
      return;
    }

    try {
      res.write(`data: {"cartId": "${out_trade_no}"}\n\n`);
      res.flush();
      retryAttempts = 0; // 成功发送，重置重试次数
    } catch (error) {
      console.error("Error sending payment state  event:", error);
      retryAttempts++;
      setTimeout(() => {
        sendPaymentstate (out_trade_no); // 重试发送
      }, 5000);
    }
  }

  eventEmitter.once("paymentSuccess", (out_trade_no) => {
    sendPaymentstate (out_trade_no);
  });

  res.on("close", () => {
    eventEmitter.off("paymentSuccess", sendPaymentstate ); // 移除事件监听器
    console.log("Client connection closed");
  });

  res.on("error", (err) => {
    console.error("Error writing to SSE client:", err);
    res.destroy(); // 关闭连接
  });

  // 心跳检测
  setInterval(() => {
    res.write("data: {}\n\n"); // 发送空数据作为心跳消息
    res.flush();
  }, 30000);
};