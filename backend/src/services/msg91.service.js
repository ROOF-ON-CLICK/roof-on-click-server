const axios = require('axios');

/**
 * MSG91 Service
 * Handles SendOTP, VerifyOTP, and Resend/Retry using MSG91 v5 APIs.
 *
 * Safe-Fallback / Simulation Mode:
 * If MSG91_AUTH_KEY is not configured in process.env, it operates in a simulated
 * test mode (accepts a dev OTP like '123456' or generated OTP logged to console)
 * so development and testing proceed smoothly without breaking the backend.
 */

const MSG91_AUTH_KEY = process.env.MSG91_AUTH_KEY;
const MSG91_OTP_TEMPLATE_ID = process.env.MSG91_OTP_TEMPLATE_ID;
const MSG91_API_BASE = 'https://control.msg91.com/api/v5/otp';

const isConfigured = Boolean(MSG91_AUTH_KEY && MSG91_OTP_TEMPLATE_ID);

if (!isConfigured) {
  console.warn(
    '[MSG91Service] MSG91_AUTH_KEY or MSG91_OTP_TEMPLATE_ID is not configured. Running in DEV SIMULATION MODE. Use OTP: 123456'
  );
}

/**
 * Normalizes an Indian phone number to 12 digits (with country code 91).
 * Accepts 10 digits (9876543210) or already prefixed (919876543210 or +919876543210).
 */
const formatMobile = (phone) => {
  const digits = String(phone).replace(/\D/g, '');
  if (digits.length === 10) return `91${digits}`;
  if (digits.length === 12 && digits.startsWith('91')) return digits;
  return digits;
};

/**
 * Sends an OTP to the given mobile number.
 * @param {string} phone 10-digit mobile number
 * @returns {Promise<{ success: boolean, message: string, simulated?: boolean }>}
 */
const sendOTP = async (phone) => {
  const mobile = formatMobile(phone);

  if (!isConfigured) {
    console.log(`[MSG91 DEV SIMULATOR] Send OTP triggered for ${mobile}. Default test OTP is: 123456`);
    return {
      success: true,
      message: 'OTP sent successfully (Simulated: use 123456).',
      simulated: true,
    };
  }

  try {
    const response = await axios.post(
      MSG91_API_BASE,
      {
        template_id: MSG91_OTP_TEMPLATE_ID,
        mobile,
        otp_length: 6,
        expiry: parseInt(process.env.MSG91_OTP_EXPIRY_MINUTES || '5', 10),
      },
      {
        headers: {
          authkey: MSG91_AUTH_KEY,
          'Content-Type': 'application/json',
        },
        timeout: 10000,
      }
    );

    if (response.data && response.data.type === 'success') {
      return { success: true, message: response.data.message || 'OTP sent successfully.' };
    }

    throw new Error(response.data?.message || 'Failed to send OTP via MSG91.');
  } catch (err) {
    console.error('[MSG91 sendOTP Error]:', err.response?.data || err.message);
    const msg = err.response?.data?.message || err.message || 'Failed to send OTP.';
    throw new Error(msg);
  }
};

/**
 * Verifies the OTP provided by the user.
 * @param {string} phone
 * @param {string} otp
 * @returns {Promise<{ success: boolean, message: string }>}
 */
const verifyOTP = async (phone, otp) => {
  const mobile = formatMobile(phone);

  if (!isConfigured) {
    // In dev simulation mode, accept 123456 or any 6-digit match if dev
    if (String(otp).trim() === '123456' || process.env.NODE_ENV === 'test') {
      return { success: true, message: 'OTP verified successfully (Simulated).' };
    }
    throw new Error('Invalid OTP. In simulation mode, please enter 123456.');
  }

  try {
    const response = await axios.get(`${MSG91_API_BASE}/verify`, {
      params: {
        mobile,
        otp: String(otp).trim(),
      },
      headers: {
        authkey: MSG91_AUTH_KEY,
      },
      timeout: 10000,
    });

    if (response.data && (response.data.type === 'success' || response.data.message === 'OTP verified success')) {
      return { success: true, message: 'OTP verified successfully.' };
    }

    throw new Error(response.data?.message || 'Invalid or expired OTP.');
  } catch (err) {
    console.error('[MSG91 verifyOTP Error]:', err.response?.data || err.message);
    const msg = err.response?.data?.message || err.message || 'Invalid OTP.';
    throw new Error(msg);
  }
};

/**
 * Retries/resends OTP via voice or whatsapp if SMS is delayed.
 * @param {string} phone
 * @param {'voice' | 'text'} retryType
 */
const retryOTP = async (phone, retryType = 'voice') => {
  const mobile = formatMobile(phone);

  if (!isConfigured) {
    console.log(`[MSG91 DEV SIMULATOR] Retry OTP (${retryType}) triggered for ${mobile}.`);
    return { success: true, message: `OTP resent via ${retryType} (Simulated).` };
  }

  try {
    const response = await axios.get(`${MSG91_API_BASE}/retry`, {
      params: {
        mobile,
        retrytype: retryType,
      },
      headers: {
        authkey: MSG91_AUTH_KEY,
      },
      timeout: 10000,
    });

    return {
      success: true,
      message: response.data?.message || `OTP resent via ${retryType}.`,
    };
  } catch (err) {
    console.error('[MSG91 retryOTP Error]:', err.response?.data || err.message);
    const msg = err.response?.data?.message || err.message || 'Failed to retry OTP.';
    throw new Error(msg);
  }
};

module.exports = {
  isConfigured,
  sendOTP,
  verifyOTP,
  retryOTP,
};
