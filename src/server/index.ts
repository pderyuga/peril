import amqp from "amqplib";
import { publishJSON } from "../internal/pubsub/publish.js";
import {
  ExchangePerilDirect,
  ExchangePerilTopic,
  GameLogSlug,
  PauseKey,
} from "../internal/routing/routing.js";
import type { PlayingState } from "../internal/gamelogic/gamestate.js";
import { printServerHelp, getInput } from "../internal/gamelogic/gamelogic.js";
import { AckType, SimpleQueueType } from "../internal/pubsub/consume.js";
import { subscribeMsgPack } from "../internal/pubsub/consume.js";
import { writeLog, type GameLog } from "../internal/gamelogic/logs.js";

async function main() {
  console.log("Starting Peril server...");

  const connectionString = "amqp://guest:guest@localhost:5672/";
  const rabbitMq = await amqp.connect(connectionString);
  console.log("Connection to RabbitMQ was successful!");

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

  await subscribeMsgPack(
    rabbitMq,
    ExchangePerilTopic,
    GameLogSlug,
    `${GameLogSlug}.*`,
    SimpleQueueType.DURABLE,
    handlerLogs()
  );

  // Used to run the server from a non-interactive source, like the multiserver.sh file
  if (!process.stdin.isTTY) {
    console.log("Non-interactive mode: skipping command input.");
    return;
  }

  // Interactive mode: setup command channel and start command loop
  const confirmChannel = await rabbitMq.createConfirmChannel();
  printServerHelp();

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

function handlerLogs(): (gameLog: GameLog) => Promise<AckType> {
  return async (gameLog: GameLog) => {
    try {
      await writeLog(gameLog);
      return AckType.Ack;
    } catch (err) {
      console.error("Error writing game log: ", err);
      return AckType.NackDiscard;
    } finally {
      process.stdout.write("> ");
    }
  };
}
