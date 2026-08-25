const Razorpay = require('razorpay');

const key_id = process.env.RAZORPAY_KEY_ID || 'rzp_test_placeholder';
const key_secret = process.env.RAZORPAY_KEY_SECRET || 'placeholder_secret';

let razorpayInstance = null;

try {
  razorpayInstance = new Razorpay({
    key_id,
    key_secret,
  });
} catch (err) {
  console.warn('[Razorpay] Failed to initialize Razorpay SDK with provided credentials:', err.message);
}

module.exports = {
  razorpayInstance,
  key_id,
  key_secret,
};
