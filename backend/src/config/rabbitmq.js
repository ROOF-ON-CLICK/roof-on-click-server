'use strict';

const amqp = require('amqp-connection-manager');

const currentEnv = (process.env.NODE_ENV || process.env.ENV || 'development').toLowerCase();
const ENV_PREFIX = currentEnv === 'production' || currentEnv === 'prod' ? 'prod' : 'dev';

// RabbitMQ topology definitions dynamically prefixed by environment
const EXCHANGES = {
  EVENTS: `${ENV_PREFIX}.roof.events`,
  DLX: `${ENV_PREFIX}.roof.events.dlx`,
};

const QUEUES = {
  NOTIFICATIONS_EMAIL: `${ENV_PREFIX}.q.notifications.email`,
  NOTIFICATIONS_WEBPUSH: `${ENV_PREFIX}.q.notifications.webpush`,
  AUTH_EMAILS: `${ENV_PREFIX}.q.auth.emails`,
  WEBHOOKS: `${ENV_PREFIX}.q.webhooks`,
  DEAD_LETTER: `${ENV_PREFIX}.q.dead_letter`,
};

const ROUTING_KEYS = {
  NOTIFY_EMAIL: 'notify.email',
  NOTIFY_WEBPUSH: 'notify.push',
  AUTH_EMAIL: 'auth.email',
  WEBHOOK_N8N: 'webhook.n8n',
};

const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://localhost:5672';

let connection = null;
let channelWrapper = null;

async function assertTopology(channel) {
  // 1. Assert Dead Letter Exchange and Queue
  await channel.assertExchange(EXCHANGES.DLX, 'direct', { durable: true });
  await channel.assertQueue(QUEUES.DEAD_LETTER, { durable: true });
  await channel.bindQueue(QUEUES.DEAD_LETTER, EXCHANGES.DLX, 'dead_letter');

  // 2. Assert Primary Topic Exchange
  await channel.assertExchange(EXCHANGES.EVENTS, 'topic', { durable: true });

  // Common queue configuration with Dead Letter Routing
  const queueOptions = {
    durable: true,
    deadLetterExchange: EXCHANGES.DLX,
    deadLetterRoutingKey: 'dead_letter',
  };

  // 3. Assert Work Queues
  await channel.assertQueue(QUEUES.NOTIFICATIONS_EMAIL, queueOptions);
  await channel.assertQueue(QUEUES.NOTIFICATIONS_WEBPUSH, queueOptions);
  await channel.assertQueue(QUEUES.AUTH_EMAILS, queueOptions);
  await channel.assertQueue(QUEUES.WEBHOOKS, queueOptions);

  // 4. Bind Queues to Exchange
  await channel.bindQueue(QUEUES.NOTIFICATIONS_EMAIL, EXCHANGES.EVENTS, ROUTING_KEYS.NOTIFY_EMAIL);
  await channel.bindQueue(QUEUES.NOTIFICATIONS_WEBPUSH, EXCHANGES.EVENTS, ROUTING_KEYS.NOTIFY_WEBPUSH);
  await channel.bindQueue(QUEUES.AUTH_EMAILS, EXCHANGES.EVENTS, ROUTING_KEYS.AUTH_EMAIL);
  await channel.bindQueue(QUEUES.WEBHOOKS, EXCHANGES.EVENTS, ROUTING_KEYS.WEBHOOK_N8N);

  console.log(`[RabbitMQ] Topology asserted with prefix [${ENV_PREFIX}]`);
}

/**
 * Initializes resilient RabbitMQ connection and sets up exchange/queue topology.
 */
function initRabbitMQ() {
  if (connection) return { connection, channelWrapper };

  connection = amqp.connect([RABBITMQ_URL], {
    heartbeatIntervalInSeconds: 10,
    reconnectTimeInSeconds: 5,
  });

  connection.on('connect', () => {
    console.log(`[RabbitMQ] Connected to broker [${ENV_PREFIX}] at ${RABBITMQ_URL}`);
  });

  connection.on('disconnect', (params) => {
    console.warn('[RabbitMQ] Broker disconnected:', params.err ? params.err.message : 'Unknown reason');
  });

  channelWrapper = connection.createChannel({
    json: true,
    setup: assertTopology,
  });

  return { connection, channelWrapper };
}

function getConnection() {
  if (!connection) initRabbitMQ();
  return connection;
}

function getChannelWrapper() {
  if (!channelWrapper) initRabbitMQ();
  return channelWrapper;
}

module.exports = {
  initRabbitMQ,
  assertTopology,
  getConnection,
  getChannelWrapper,
  ENV_PREFIX,
  EXCHANGES,
  QUEUES,
  ROUTING_KEYS,
};
