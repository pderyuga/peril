import type { ConfirmChannel } from "amqplib";

export async function publishJSON<T>(
  ch: ConfirmChannel,
  exchange: string,
  routingKey: string,
  value: T
): Promise<void> {
  // Serialize value to JSON bytes
  const jsonString = JSON.stringify(value);
  const buffer = Buffer.from(jsonString);

  // Publish the message to the exchange with the routing key
  return new Promise((resolve, reject) => {
    ch.publish(
      exchange,
      routingKey,
      buffer,
      {
        contentType: "application/json",
      },
      (err) => {
        if (err) {
          reject(new Error("Message was NAKed by the broker"));
        } else {
          resolve();
        }
      }
    );
  });
}
