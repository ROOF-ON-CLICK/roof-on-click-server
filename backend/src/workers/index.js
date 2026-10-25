const { getConnection, assertTopology, QUEUES } = require('../config/rabbitmq');
const { processEmailNotification } = require('./email.worker');
const { processPushNotification } = require('./push.worker');
const { processWebhook } = require('./webhook.worker');

/**
 * Initializes consumers on all asserted background queues.
 */
function startConsumers() {
  const connection = getConnection();

  connection.createChannel({
    setup: async (channel) => {
      // Ensure exchange, queues and bindings exist before consuming
      await assertTopology(channel);

      // Set prefetch to prevent worker saturation
      await channel.prefetch(10);

      // 1. Notifications Email Queue Consumer
      await channel.consume(
        QUEUES.NOTIFICATIONS_EMAIL,
        async (msg) => {
          if (!msg) return;
          try {
            const content = JSON.parse(msg.content.toString());
            await processEmailNotification({
              type: 'NOTIFICATION_EMAIL',
              payload: content,
            });
            channel.ack(msg);
          } catch (err) {
            console.error('[Consumer:NotificationEmail] Error processing message:', err.message);
            // Reject without requeue sends directly to DLX
            channel.nack(msg, false, false);
          }
        },
        { noAck: false }
      );

      // 2. Auth Emails Queue Consumer
      await channel.consume(
        QUEUES.AUTH_EMAILS,
        async (msg) => {
          if (!msg) return;
          try {
            const content = JSON.parse(msg.content.toString());
            await processEmailNotification(content);
            channel.ack(msg);
          } catch (err) {
            console.error('[Consumer:AuthEmails] Error processing message:', err.message);
            channel.nack(msg, false, false);
          }
        },
        { noAck: false }
      );

      // 3. Web Push Queue Consumer
      await channel.consume(
        QUEUES.NOTIFICATIONS_WEBPUSH,
        async (msg) => {
          if (!msg) return;
          try {
            const content = JSON.parse(msg.content.toString());
            await processPushNotification(content);
            channel.ack(msg);
          } catch (err) {
            console.error('[Consumer:WebPush] Error processing message:', err.message);
            channel.nack(msg, false, false);
          }
        },
        { noAck: false }
      );

      // 4. Webhook Queue Consumer
      await channel.consume(
        QUEUES.WEBHOOKS,
        async (msg) => {
          if (!msg) return;
          try {
            const content = JSON.parse(msg.content.toString());
            await processWebhook(content);
            channel.ack(msg);
          } catch (err) {
            console.error('[Consumer:Webhooks] Error processing message:', err.message);
            channel.nack(msg, false, false);
          }
        },
        { noAck: false }
      );

      console.log('[RabbitMQ] All consumer workers registered and active.');
    },
  });
}

module.exports = {
  startConsumers,
};
