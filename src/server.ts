import 'dotenv/config'; // load .env before config reads process.env (entry point only)
import { createApp } from './app';
import { config } from './config';

const app = createApp();

const server = app.listen(config.port, () => {
  // eslint-disable-next-line no-console
  console.log(
    `ai-diff-review-service v${config.version} listening on :${config.port}`,
  );
});

// Never let an unexpected error take down the process.
process.on('uncaughtException', (err) => {
  // eslint-disable-next-line no-console
  console.error('uncaughtException:', err);
});
process.on('unhandledRejection', (reason) => {
  // eslint-disable-next-line no-console
  console.error('unhandledRejection:', reason);
});

export { server };
