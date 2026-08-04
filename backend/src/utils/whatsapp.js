/**
 * Normalizes an Indian mobile number to the E.164 format required by wa.me.
 * Accepts: "9876543210", "+919876543210", "919876543210"
 * Always returns: "919876543210" (91 + 10 digits)
 *
 * @param {string} phone - Raw phone number in any accepted format
 * @returns {string} - Normalized 12-digit string (91 + 10 digits)
 */
const normalizeIndianPhone = (phone) => {
  const digits = phone.replace(/\D/g, '');

  // Already has 91 country code (12 digits total)
  if (digits.length === 12 && digits.startsWith('91')) {
    return digits;
  }

  // Bare 10-digit number — prepend country code
  if (digits.length === 10) {
    return `91${digits}`;
  }

  // Fallback — return as-is (validation should have caught bad numbers)
  return digits;
};

/**
 * Builds a pre-filled WhatsApp URL using the wa.me format.
 *
 * @param {string} phone - Indian phone number in any accepted format
 * @param {object} listing - { title, type, area }
 * @returns {string} - Full wa.me URL with encoded message
 */
const buildWhatsAppUrl = (phone, { title, type, area }) => {
  const normalizedPhone = normalizeIndianPhone(phone);

  const message =
    `Hi, I found your listing "${title}" on RoofOnClick.\n` +
    `I'm interested in the ${type} available in ${area}.\n` +
    `Could you please share more details?`;

  return `https://wa.me/${normalizedPhone}?text=${encodeURIComponent(message)}`;
};

module.exports = { buildWhatsAppUrl, normalizeIndianPhone };
