/** Віддає відкриті налаштування сторінки. Ідентифікатор клієнта Google не є секретом. */
export default function handler(req, res) {
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.status(200).json({
    clientId: process.env.GOOGLE_CLIENT_ID || '',
    domain: process.env.ALLOWED_DOMAIN || ''
  });
}
