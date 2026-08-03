/**
 * Builds a pre-filled WhatsApp URL using the wa.me format.
 *
 * @param {string} phone - Phone number with country code (e.g. "919876543210")
 * @param {object} listing - { title, type, area }
 * @returns {string} - Full wa.me URL with encoded message
 */
const buildWhatsAppUrl = (phone, { title, type, area }) => {
  // Sanitize phone — strip non-digits and ensure country code
  const sanitizedPhone = phone.replace(/\D/g, '');

  const message = `Hi, I found your listing "${title}" on RoofOnClick.\nI'm interested in the ${type} available in ${area}.\nCould you please share more details?`;

  const encoded = encodeURIComponent(message);
  return `https://wa.me/${sanitizedPhone}?text=${encoded}`;
};

module.exports = { buildWhatsAppUrl };
