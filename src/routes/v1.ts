import { Router } from 'express';
import { requireAuth } from '../http/auth';
import { reviewsRouter } from './reviews';

/**
 * Router for all /v1/* routes. Auth is applied here so every route mounted on
 * it (reviews POST/GET/stream) is protected — including unknown /v1 subpaths,
 * which hit auth before falling through to 404.
 */
export const v1Router = Router();

v1Router.use(requireAuth);
v1Router.use(reviewsRouter);
