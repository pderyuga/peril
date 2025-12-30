import amqp from "amqplib";
import {
  clientWelcome,
  commandStatus,
  getInput,
  printClientHelp,
  printQuit,
} from "../internal/gamelogic/gamelogic.js";
import {
  declareAndBind,
  SimpleQueueType,
  subscribeJSON,
} from "../internal/pubsub/consume.js";
import {
  ExchangePerilDirect,
  ExchangePerilTopic,
  PauseKey,
  ArmyMovesPrefix,
} from "../internal/routing/routing.js";
import {
  GameState,
  type PlayingState,
} from "../internal/gamelogic/gamestate.js";
import { commandSpawn } from "../internal/gamelogic/spawn.js";
import { commandMove, handleMove } from "../internal/gamelogic/move.js";
import { type ArmyMove } from "../internal/gamelogic/gamedata.js";
import { handlePause } from "../internal/gamelogic/pause.js";
import { publishJSON } from "../internal/pubsub/publish.js";

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

  const gameState = new GameState(username);

  await subscribeJSON(
    rabbitMq,
    ExchangePerilDirect,
    `${PauseKey}.${username}`,
    PauseKey,
    SimpleQueueType.TRANSIENT,
    handlerPause(gameState)
  );

  await subscribeJSON(
    rabbitMq,
    ExchangePerilTopic,
    `${ArmyMovesPrefix}.${username}`,
    `${ArmyMovesPrefix}.*`,
    SimpleQueueType.TRANSIENT,
    handlerMove(gameState)
  );

  const publishChannel = await rabbitMq.createConfirmChannel();

  while (true) {
    const words = await getInput();
    if (!words.length) {
      continue;
    }

    if (words[0] === "spawn") {
      try {
        commandSpawn(gameState, words);
      } catch (err) {
        console.log((err as Error).message);
      }
    }

    if (words[0] === "move") {
      try {
        const move = commandMove(gameState, words);
        await publishJSON(
          publishChannel,
          ExchangePerilTopic,
          `${ArmyMovesPrefix}.${username}`,
          move
        );
      } catch (err) {
        console.log((err as Error).message);
      }
    }

    if (words[0] === "status") {
      await commandStatus(gameState);
    }

    if (words[0] === "help") {
      printClientHelp();
    }

    if (words[0] === "spam") {
      console.log("Spamming not allowed yet!");
    }

    if (words[0] === "quit") {
      printQuit();
      process.exit(0);
    }

    if (
      words[0] &&
      !["spawn", "move", "status", "help", "spam", "quit"].includes(words[0])
    ) {
      console.log(`Unknown command: ${words}`);
      continue;
    }
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});

function handlerPause(gs: GameState): (ps: PlayingState) => void {
  return (ps: PlayingState) => {
    handlePause(gs, ps);
    process.stdout.write("> ");
  };
}

function handlerMove(gs: GameState): (move: ArmyMove) => void {
  return (move: ArmyMove) => {
    handleMove(gs, move);
    process.stdout.write("> ");
  };
}
