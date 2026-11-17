/**
 * Віддає дані дашборда лише тим, хто увійшов робочим акаунтом Google.
 *
 * Перевіряє підпис токена ключами Google, звіряє домен пошти
 * і тільки тоді йде за даними в Apps Script із секретним ключем.
 * Ключ живе у змінних оточення Vercel і в браузер не потрапляє.
 */
import { createRemoteJWKSet, jwtVerify } from 'jose';

const JWKS = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));

function allowed(payload) {
  const domain = String(process.env.ALLOWED_DOMAIN || '').toLowerCase().trim();
  const extra = String(process.env.ALLOWED_EMAILS || '')
    .toLowerCase().split(',').map((s) => s.trim()).filter(Boolean);
  const email = String(payload.email || '').toLowerCase();
  const hd = String(payload.hd || '').toLowerCase();
  if (!payload.email_verified) return false;
  if (extra.includes(email)) return true;
  if (!domain) return false;
  return hd === domain || email.endsWith('@' + domain);
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Підтримується тільки POST' });
  }
  const { GOOGLE_CLIENT_ID, GAS_URL, GAS_KEY } = process.env;
  if (!GOOGLE_CLIENT_ID || !GAS_URL || !GAS_KEY) {
    return res.status(500).json({ error: 'Сервер не налаштований: бракує змінних оточення' });
  }

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  const credential = body && body.credential;
  if (!credential) return res.status(400).json({ error: 'Немає токена входу' });

  let payload;
  try {
    ({ payload } = await jwtVerify(credential, JWKS, {
      issuer: ['https://accounts.google.com', 'accounts.google.com'],
      audience: GOOGLE_CLIENT_ID
    }));
  } catch {
    return res.status(401).json({ error: 'Вхід не підтверджено. Спробуйте увійти ще раз.' });
  }

  if (!allowed(payload)) {
    return res.status(403).json({
      error: 'Доступ лише для робочих акаунтів Ескади. Увійдіть поштою на домені компанії.'
    });
  }

  let data;
  try {
    const r = await fetch(`${GAS_URL}?key=${encodeURIComponent(GAS_KEY)}`, { redirect: 'follow' });
    if (!r.ok) throw new Error('Apps Script відповів ' + r.status);
    data = await r.json();
  } catch (e) {
    return res.status(502).json({ error: 'Не вдалося отримати дані: ' + e.message });
  }
  if (data && data.error) {
    return res.status(502).json({ error: 'Apps Script: ' + data.error });
  }

  return res.status(200).json({
    user: { email: payload.email, name: payload.name || payload.email, picture: payload.picture || '' },
    data
  });
}
