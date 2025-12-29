import amqp, { type Channel } from "amqplib";

export enum SimpleQueueType {
  DURABLE = "durable",
  TRANSIENT = "transient",
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
