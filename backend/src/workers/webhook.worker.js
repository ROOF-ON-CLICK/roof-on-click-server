'use strict';

const N8N_WEBHOOK_URL = process.env.N8N_WEBHOOK_URL || null;
const N8N_WEBHOOK_SECRET = process.env.N8N_WEBHOOK_SECRET || null;

/**
 * Handles outgoing HTTP webhooks (n8n, etc.) asynchronously.
 */
async function processWebhook({ payload }) {
  if (!N8N_WEBHOOK_URL) return;

  const headers = {
    'Content-Type': 'application/json',
    'User-Agent': 'RoofOnClick-NotificationService/1.0',
  };

  if (N8N_WEBHOOK_SECRET) {
    headers['X-RoofOnClick-Webhook-Secret'] = N8N_WEBHOOK_SECRET;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000);

  try {
    const response = await fetch(N8N_WEBHOOK_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      console.warn(`[webhook.worker] n8n webhook responded with status ${response.status}`);
    }
  } catch (err) {
    clearTimeout(timeoutId);
    console.error('[webhook.worker] Failed to dispatch n8n webhook:', err.message);
  }
}

module.exports = {
  processWebhook,
};
