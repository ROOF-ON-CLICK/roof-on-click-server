'use strict';

const { getChannelWrapper, EXCHANGES } = require('../config/rabbitmq');

/**
 * Publishes a JSON payload to the environment topic exchange.
 * amqp-connection-manager automatically buffers messages in memory if RabbitMQ is temporarily down.
 *
 * @param {string} routingKey - The routing key (e.g., 'notify.email', 'auth.email')
 * @param {object} payload - The serializable message payload
 * @param {object} [options={}] - Additional amqplib message options (persistent, priority, headers)
 */
async function publishMessage(routingKey, payload, options = {}) {
  try {
    const channelWrapper = getChannelWrapper();
    const publishOptions = {
      persistent: true,
      ...options,
    };

    await channelWrapper.publish(EXCHANGES.EVENTS, routingKey, payload, publishOptions);
    return true;
  } catch (err) {
    console.error(`[QueueService] Error publishing to ${routingKey}:`, err.message);
    // Non-blocking fallback: Log error without taking down caller thread
    return false;
  }
}

module.exports = {
  publishMessage,
};
