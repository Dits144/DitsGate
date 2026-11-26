import React from 'react';

export function ProviderIcon({ id, size = 18 }: { id: string; size?: number }) {
  const s = size;
  switch (id) {
    case 'gopay':
      return (
        <svg width={s} height={s} viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <rect width="24" height="24" rx="6" fill="#00AED6" />
          <circle cx="12" cy="12" r="5.5" stroke="#fff" strokeWidth="2.2" />
          <circle cx="12" cy="12" r="2" fill="#fff" />
        </svg>
      );
    case 'shopee':
      return (
        <svg width={s} height={s} viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <rect width="24" height="24" rx="6" fill="#EE4D2D" />
          <path d="M8.5 9V7.8a3.5 3.5 0 0 1 7 0V9" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" />
          <path d="M6.5 9.2h11l-.8 9.1a1.5 1.5 0 0 1-1.5 1.4H8.8a1.5 1.5 0 0 1-1.5-1.4L6.5 9.2Z" fill="#fff" />
          <path d="M13.6 12.2c-.4-.3-.9-.4-1.5-.4-.9 0-1.5.4-1.5 1 0 .7.7.9 1.6 1.1 1 .2 1.8.6 1.8 1.6 0 1-.9 1.6-2.1 1.6-.9 0-1.6-.3-2.1-.7" stroke="#EE4D2D" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      );
    case 'bca':
      return (
        <svg width={s} height={s} viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <rect width="24" height="24" rx="6" fill="#00529C" />
          <path d="M6.5 16.5L10.5 7.5h3l4 9h-2.5l-.8-2h-4.4l-.8 2H6.5Zm4.1-4h2.8L12 9.4l-1.4 3.1Z" fill="#fff" />
        </svg>
      );
    case 'linkaja':
      return (
        <svg width={s} height={s} viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <rect width="24" height="24" rx="6" fill="#E31E24" />
          <path d="M7.5 8v8h4" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M13 16l2-8 2 8m-3.4-2.5h2.8" stroke="#fff" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case 'bri':
      return (
        <svg width={s} height={s} viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <rect width="24" height="24" rx="6" fill="#00529C" />
          <rect x="4.5" y="4.5" width="15" height="15" rx="3.5" stroke="#F37021" strokeWidth="1.8" />
          <path d="M8.5 8.5h3.2c1.2 0 2 .6 2 1.6 0 .7-.4 1.2-1 1.4.8.2 1.3.8 1.3 1.7 0 1.2-.9 1.8-2.2 1.8H8.5V8.5Z" fill="#fff" />
        </svg>
      );
    case 'mandiri':
      return (
        <svg width={s} height={s} viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <rect width="24" height="24" rx="6" fill="#003D79" />
          <path d="M5 14.5c3.5-2.5 7-2.5 14 0" stroke="#FFB81C" strokeWidth="2.2" strokeLinecap="round" />
          <path d="M6.5 10.5c3-1.6 6-1.6 11 0" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      );
    case 'listener':
    default:
      return (
        <svg width={s} height={s} viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <rect width="24" height="24" rx="6" fill="#4F46E5" />
          <rect x="8.5" y="5" width="7" height="14" rx="1.6" stroke="#fff" strokeWidth="1.7" />
          <circle cx="12" cy="16" r="0.9" fill="#fff" />
          <path d="M17.5 9.5a3.5 3.5 0 0 1 0 5M6.5 9.5a3.5 3.5 0 0 0 0 5" stroke="#A5B4FC" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      );
  }
}
