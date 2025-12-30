import amqp, { type Channel } from "amqplib";

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

  const queue = await channel.assertQueue(queueName, {
    durable: queueType === SimpleQueueType.DURABLE,
    autoDelete: queueType === SimpleQueueType.TRANSIENT,
    exclusive: queueType === SimpleQueueType.TRANSIENT,
  });

  await channel.bindQueue(queueName, exchange, key);

  return [channel, queue];
}

export async function subscribeJSON<T>(
  conn: amqp.ChannelModel,
  exchange: string,
  queueName: string,
  key: string,
  queueType: SimpleQueueType,
  handler: (data: T) => AckType
): Promise<void> {
  const [channel, queue] = await declareAndBind(
    conn,
    exchange,
    queueName,
    key,
    queueType
  );

  const onMessage = (message: amqp.ConsumeMessage | null) => {
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
      const result = handler(parsedMessage);

      if (result === AckType.Ack) {
        channel.ack(message);
        console.log("Message acknowledged");
      }

      if (result === AckType.NackRequeue) {
        channel.nack(message, false, true);
        console.log("Message NACKed and requeued");
      }

      if (result === AckType.NackDiscard) {
        channel.nack(message, false, false);
        console.log("Message NACKed and discarded");
      }
    } catch (err) {
      console.error("Error handling message: ", err);
      channel.nack(message, false, false);
      return;
    }
  };

  await channel.consume(queue.queue, onMessage);
}
