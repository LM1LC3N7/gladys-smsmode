// -----------------------------------------------------------------------------
// Entry point: SDK wiring only. Every handler is registered BEFORE connect(),
// and delegates to the App (src/app.js). An SMS leaves only from the scene
// action and the test button.
//
// Environment variables provided by the Gladys supervisor, read by the SDK:
// GLADYS_HOST_API_URL, GLADYS_INTEGRATION_TOKEN, GLADYS_INTEGRATION_SELECTOR.
// -----------------------------------------------------------------------------

import { GladysIntegration, logger } from '@gladysassistant/integration-sdk';
import { App } from './src/app.js';
import { ACTIONS, SCENE_ACTION } from './src/constants.js';
import { createFileStore } from './src/store.js';

const gladys = new GladysIntegration();
const app = new App({ gladys, logger, store: createFileStore() });

gladys.onSceneAction(SCENE_ACTION, (fields) => app.sceneSend(fields));
gladys.onAction(ACTIONS.TEST, (fields) => app.testSend(fields));
gladys.onAction(ACTIONS.CHECK, () => app.checkAccount());
gladys.onConfigUpdated((config) => app.configUpdated(config));

// A disconnection stops nothing: no scene action can arrive meanwhile, and a
// send in flight finishes and is counted.
gladys.on('connected', () => {
  app.connected().catch((err) => logger.error('Start failed', err));
});
gladys.handleShutdown(() => app.stop());

logger.info('Starting the smsmode integration...');
gladys.connect().catch((err) => {
  logger.error('Initial connection failed', err);
  process.exit(1);
});
