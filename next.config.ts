import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  trailingSlash: false,
  // pdf-parse is a CommonJS PDF text extractor used server-side by
  // /api/assessment-upload; keep it out of the bundle so it loads from
  // node_modules at runtime.
  serverExternalPackages: ['pdf-parse'],
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-XSS-Protection', value: '1; mode=block' },
          { key: 'Permissions-Policy', value: 'geolocation=(), microphone=(), camera=()' },
          { key: 'Content-Security-Policy', value: "default-src 'self'; script-src 'self' 'unsafe-inline' https://consent.cookiebot.com https://consentcdn.cookiebot.com https://www.google.com https://www.recaptcha.net https://apis.google.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob: https://storage.googleapis.com https://firebasestorage.googleapis.com https://lh3.googleusercontent.com; connect-src 'self' https://identitytoolkit.googleapis.com https://securetoken.googleapis.com https://firestore.googleapis.com https://storage.googleapis.com https://firebasestorage.googleapis.com https://firebaseappcheck.googleapis.com https://firebaseinstallations.googleapis.com wss://firestore.googleapis.com https://api.stripe.com https://www.google.com https://www.recaptcha.net https://cdn.jsdelivr.net https://login.microsoftonline.com https://nearwork-97e3c.firebaseapp.com; frame-src 'self' https://www.google.com https://www.recaptcha.net https://nearwork-97e3c.firebaseapp.com https://apis.google.com https://login.microsoftonline.com; object-src 'none'; base-uri 'self'; frame-ancestors 'none';" },
          { key: 'Content-Security-Policy-Report-Only', value: "default-src 'self'; script-src 'self' 'unsafe-inline' https://consent.cookiebot.com https://consentcdn.cookiebot.com https://www.google.com https://www.recaptcha.net https://apis.google.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob: https://storage.googleapis.com https://firebasestorage.googleapis.com https://lh3.googleusercontent.com; connect-src 'self' https://identitytoolkit.googleapis.com https://securetoken.googleapis.com https://firestore.googleapis.com https://storage.googleapis.com https://firebasestorage.googleapis.com https://firebaseappcheck.googleapis.com https://firebaseinstallations.googleapis.com wss://firestore.googleapis.com https://api.stripe.com https://www.google.com https://www.recaptcha.net https://cdn.jsdelivr.net https://login.microsoftonline.com https://nearwork-97e3c.firebaseapp.com; frame-src 'self' https://www.google.com https://www.recaptcha.net https://nearwork-97e3c.firebaseapp.com https://apis.google.com https://login.microsoftonline.com; object-src 'none'; base-uri 'self'; frame-ancestors 'none';" },
        ],
      },
    ];
  },
};

export default nextConfig;
