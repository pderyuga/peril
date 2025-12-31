import amqp, { type ConfirmChannel } from "amqplib";
import {
  clientWelcome,
  commandStatus,
  getInput,
  getMaliciousLog,
  printClientHelp,
  printQuit,
} from "../internal/gamelogic/gamelogic.js";
import {
  SimpleQueueType,
  subscribeJSON,
  AckType,
} from "../internal/pubsub/consume.js";
import {
  ExchangePerilDirect,
  ExchangePerilTopic,
  GameLogSlug,
  PauseKey,
  ArmyMovesPrefix,
  WarRecognitionsPrefix,
} from "../internal/routing/routing.js";
import {
  GameState,
  type PlayingState,
} from "../internal/gamelogic/gamestate.js";
import { commandSpawn } from "../internal/gamelogic/spawn.js";
import {
  commandMove,
  handleMove,
  MoveOutcome,
} from "../internal/gamelogic/move.js";
import {
  type ArmyMove,
  type RecognitionOfWar,
} from "../internal/gamelogic/gamedata.js";
import { handlePause } from "../internal/gamelogic/pause.js";
import { publishJSON, publishMsgPack } from "../internal/pubsub/publish.js";
import { handleWar, WarOutcome } from "../internal/gamelogic/war.js";
import { type GameLog } from "../internal/gamelogic/logs.js";

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
  const gameState = new GameState(username);
  const publishChannel = await rabbitMq.createConfirmChannel();

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
    handlerMove(gameState, publishChannel)
  );

  await subscribeJSON(
    rabbitMq,
    ExchangePerilTopic,
    `${WarRecognitionsPrefix}`,
    `${WarRecognitionsPrefix}.*`,
    SimpleQueueType.DURABLE,
    handlerWar(gameState, publishChannel)
  );

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
      if (words.length !== 2 || isNaN(Number(words[1]))) {
        console.error("usage: spam <number> ");
      }

      const n = Number(words[1]);
      for (let i = 0; i < n; i++) {
        try {
          publishMsgPack(
            publishChannel,
            ExchangePerilTopic,
            `${GameLogSlug}.${username}`,
            getMaliciousLog()
          );
        } catch (err) {
          console.error(
            "Failed to publish spam message: ",
            (err as Error).message
          );
          continue;
        }
      }
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

function handlerPause(gs: GameState): (ps: PlayingState) => AckType {
  return (ps: PlayingState) => {
    handlePause(gs, ps);
    process.stdout.write("> ");
    return AckType.Ack;
  };
}

function handlerMove(
  gs: GameState,
  publishChannel: amqp.ConfirmChannel
): (move: ArmyMove) => Promise<AckType> {
  return async (move: ArmyMove) => {
    try {
      const moveOutcome = handleMove(gs, move);
      switch (moveOutcome) {
        case MoveOutcome.Safe:
        case MoveOutcome.SamePlayer:
          return AckType.Ack;
        case MoveOutcome.MakeWar:
          const recognitionOfWar: RecognitionOfWar = {
            attacker: move.player,
            defender: gs.getPlayerSnap(),
          };

          try {
            await publishJSON(
              publishChannel,
              ExchangePerilTopic,
              `${WarRecognitionsPrefix}.${gs.getUsername()}`,
              recognitionOfWar
            );
            return AckType.Ack;
          } catch (err) {
            console.error("Error publishing war recognition: ", err);
            return AckType.NackRequeue;
          }
        default:
          return AckType.NackDiscard;
      }
    } finally {
      process.stdout.write("> ");
    }
  };
}

function handlerWar(
  gs: GameState,
  publishChannel: ConfirmChannel
): (rw: RecognitionOfWar) => Promise<AckType> {
  return async (rw: RecognitionOfWar) => {
    try {
      const warResolution = handleWar(gs, rw);

      switch (warResolution.result) {
        case WarOutcome.NotInvolved:
          return AckType.NackRequeue;
        case WarOutcome.NoUnits:
          return AckType.NackDiscard;
        case WarOutcome.OpponentWon:
        case WarOutcome.YouWon:
          try {
            const message = `${warResolution.winner} won a war against ${warResolution.loser}`;
            await publishGameLog(publishChannel, rw.attacker.username, message);
            return AckType.Ack;
          } catch (err) {
            console.error("Error publishing game log: ", err);
            return AckType.NackRequeue;
          }
        case WarOutcome.Draw:
          try {
            const message = `A war between ${warResolution.attacker} and ${warResolution.defender} ended in a draw`;
            await publishGameLog(publishChannel, rw.attacker.username, message);
            return AckType.Ack;
          } catch (err) {
            console.error("Error publishing game log: ", err);
            return AckType.NackRequeue;
          }
        default:
          return AckType.NackDiscard;
      }
    } catch (err) {
      console.error("Error has occurred: ", err);
      return AckType.NackDiscard;
    } finally {
      process.stdout.write("> ");
    }
  };
}

async function publishGameLog(
  channel: ConfirmChannel,
  username: string,
  message: string
): Promise<void> {
  const gameLog: GameLog = {
    currentTime: new Date(),
    message,
    username,
  };

  await publishMsgPack(
    channel,
    ExchangePerilTopic,
    `${GameLogSlug}.${username}`,
    gameLog
  );
}
