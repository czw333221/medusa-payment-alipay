import { MedusaRequest, MedusaResponse } from "@medusajs/medusa";
import AlialyProvider from "../../../services/alipay-provider";
import { getEventEmitter } from "../../events/eventEmitterModule";

export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const alipayService: AlialyProvider = req.scope.resolve(
    "alipayProviderService"
  );
  const manager = req.scope.resolve("manager");
  const cartService = req.scope.resolve("cartService");
  const query = (req as any).query;
  const out_trade_no = query.out_trade_no;
  try {
    console.log(query);
    if (alipayService.verifyAlipayNotify(query)) {
      await manager.transaction(async (m) => {
        const cart = await cartService
          .withTransaction(m)
          .retrieve(out_trade_no);
        if (cart.item_tax_total === query.total_amount) {
          (req as any).status(200).send("success");
        } else {
          (req as any).status(200).send("fail");
        }
      });
    }
  } catch (err) {
    res.status(400).send(`notifyurl Error: ${err.message}`);
    return;
  }
  function isPaymentCollection(id) {
    return id && id.startsWith("paycol");
  }
  async function autorizeCart(req, cartId) {
    const manager = req.scope.resolve("manager");
    const cartService = req.scope.resolve("cartService");
    const swapService = req.scope.resolve("swapService");
    const orderService = req.scope.resolve("orderService");

    await manager.transaction(async (m) => {
      const cart = await cartService.withTransaction(m).retrieve(cartId);

      switch (cart.type) {
        case "swap": {
          const swap = await swapService
            .withTransaction(m)
            .retrieveByCartId(cartId)
            .catch((_) => undefined);

          if (swap && swap.confirmed_at === null) {
            await cartService
              .withTransaction(m)
              .setPaymentSession(cartId, "alipay");
            await cartService.withTransaction(m).authorizePayment(cartId);
            await swapService
              .withTransaction(m)
              .registerCartCompletion(swap.id);
          }
          break;
        }

        default: {
          const order = await orderService
            .withTransaction(m)
            .retrieveByCartId(cartId)
            .catch((_) => undefined);

          if (!order) {
            await cartService
              .withTransaction(m)
              .setPaymentSession(cartId, "alipays");
            await cartService.withTransaction(m).authorizePayment(cartId);
            await orderService.withTransaction(m).createFromCart(cartId);
          }
          break;
        }
      }
    });
  }

  async function autorizePaymentCollection(req, id) {
    const manager = req.scope.resolve("manager");
    const paymentCollectionService = req.scope.resolve(
      "paymentCollectionService"
    );

    await manager.transaction(async (manager) => {
      await paymentCollectionService.withTransaction(manager).authorize(id);
    });
  }
  try {
    const eventEmitter = getEventEmitter();
    eventEmitter.emit("paymentSuccess", out_trade_no);
    if (isPaymentCollection(out_trade_no)) {
      await autorizePaymentCollection(req, out_trade_no);
    } else {
      await autorizeCart(req, out_trade_no);
    }
  } catch (err) {
    res.status(400).send(`notifyurl Error: ${err.message}`);
    return;
  }
};
