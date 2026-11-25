import express from 'express';

import { captureProxyBody } from '@/utils/proxyBody';

const bodyParsers = (limit: string) => [
  express.json({ limit, verify: captureProxyBody }),
  express.text({ limit, verify: captureProxyBody }),
  express.urlencoded({ extended: false, limit, verify: captureProxyBody }),
];

// Mount after the auth check, so an anonymous caller can't make the API buffer
// and parse 32 MB before it is rejected.
export const parseBody = bodyParsers('32mb');

// For routes that take bodies before anyone is logged in (login, register).
export const parsePublicBody = bodyParsers('100kb');
