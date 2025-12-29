import amqp from "amqplib";
import { clientWelcome } from "../internal/gamelogic/gamelogic.js";
import {
  declareAndBind,
  SimpleQueueType,
} from "../internal/pubsub/declare-and-bind.js";
import { ExchangePerilDirect, PauseKey } from "../internal/routing/routing.js";

async function main() {
  console.log("Starting Peril client...");

  const connectionString = "amqp://guest:guest@localhost:5672/";
  const rabbitMq = await amqp.connect(connectionString);
  console.log("Connection to RabbitMQ was successful!");

  ["SIGINT", "SIGTERM"].forEach((signal) =>
    process.on(signal, async () => {
      try {
        await rabbitMq.close();
        console.log("RabbitMQ connection closed.");
      } catch (err) {
        console.error("Error closing RabbitMQ connection:", err);
      } finally {
        process.exit(0);
      }
    })
  );

  const username = await clientWelcome();

  await declareAndBind(
    rabbitMq,
    ExchangePerilDirect,
    `${PauseKey}.${username}`,
    PauseKey,
    SimpleQueueType.TRANSIENT
  );
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
