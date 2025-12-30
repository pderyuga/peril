import amqp, { type Channel } from "amqplib";
import { GameLogSlug } from "../routing/routing.js";

export enum SimpleQueueType {
  DURABLE = "durable",
  TRANSIENT = "transient",
}

export enum AckType {
  Ack,
  NackRequeue,
  NackDiscard,
}

export async function declareAndBind(
  conn: amqp.ChannelModel,
  exchange: string,
  queueName: string,
  key: string,
  queueType: SimpleQueueType
): Promise<[Channel, amqp.Replies.AssertQueue]> {
  // Create a new channel on the connection
  const channel = await conn.createChannel();

  const queueOptions: amqp.Options.AssertQueue = {
    durable: queueType === SimpleQueueType.DURABLE,
    autoDelete: queueType === SimpleQueueType.TRANSIENT,
    exclusive: queueType === SimpleQueueType.TRANSIENT,
  };

  if (queueName !== GameLogSlug) {
    queueOptions.arguments = {
      "x-dead-letter-exchange": "peril_dlx",
    };
  }

  const queue = await channel.assertQueue(queueName, queueOptions);

  await channel.bindQueue(queueName, exchange, key);

  return [channel, queue];
}

export async function subscribeJSON<T>(
  conn: amqp.ChannelModel,
  exchange: string,
  queueName: string,
  key: string,
  queueType: SimpleQueueType,
  handler: (data: T) => Promise<AckType> | AckType
): Promise<void> {
  const [channel, queue] = await declareAndBind(
    conn,
    exchange,
    queueName,
    key,
    queueType
  );

  const onMessage = async (message: amqp.ConsumeMessage | null) => {
    if (!message) {
      console.error("Message canceled by broker");
      return;
    }

    let parsedMessage: T;
    try {
      const messageString = message.content.toString("utf8");
      parsedMessage = JSON.parse(messageString);
    } catch (err) {
      console.error("Could not parse message:", err);
      return;
    }

    try {
      const result = await handler(parsedMessage);

      if (result === AckType.Ack) {
        channel.ack(message);
      }

      if (result === AckType.NackRequeue) {
        channel.nack(message, false, true);
      }

      if (result === AckType.NackDiscard) {
        channel.nack(message, false, false);
      }
    } catch (err) {
      console.error("Error handling message: ", err);
      channel.nack(message, false, false);
      return;
    }
  };

  await channel.consume(queue.queue, onMessage);
}
