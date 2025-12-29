import amqp from "amqplib";
import { publishJSON } from "../internal/pubsub/publish.js";
import { ExchangePerilDirect, PauseKey } from "../internal/routing/routing.js";
import type { PlayingState } from "../internal/gamelogic/gamestate.js";
import { printServerHelp, getInput } from "../internal/gamelogic/gamelogic.js";

async function main() {
  console.log("Starting Peril server...");

  const connectionString = "amqp://guest:guest@localhost:5672/";
  const rabbitMq = await amqp.connect(connectionString);
  console.log("Connection to RabbitMQ was successful!");
  printServerHelp();

  ["SIGINT", "SIGTERM"].forEach((signal) =>
    process.on(signal, async () => {
      try {
        await rabbitMq.close();
        console.log("\nRabbitMQ connection closed");
      } catch (err) {
        console.error("Error closing RabbitMQ connection: ", err);
      } finally {
        process.exit(0);
      }
    })
  );

  const confirmChannel = await rabbitMq.createConfirmChannel();

  while (true) {
    const words = await getInput();
    if (!words.length) {
      continue;
    }

    if (words[0] === "pause") {
      console.log("Sending pause message...");
      try {
        const pauseMessage: PlayingState = { isPaused: true };
        await publishJSON(
          confirmChannel,
          ExchangePerilDirect,
          PauseKey,
          pauseMessage
        );
      } catch (err) {
        console.error("Error publishing pause message: ", err);
      }
    }

    if (words[0] === "resume") {
      console.log("Sending resume message...");
      try {
        const resumeMessage: PlayingState = { isPaused: false };
        await publishJSON(
          confirmChannel,
          ExchangePerilDirect,
          PauseKey,
          resumeMessage
        );
      } catch (err) {
        console.error("Error publishing resume message: ", err);
      }
    }

    if (words[0] === "quit") {
      console.log("Exiting...");
      process.exit(0);
    }

    if (words[0] && !["pause", "resume", "quit"].includes(words[0])) {
      console.log(`Unknown command: ${words}`);
    }
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
