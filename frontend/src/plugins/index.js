/**
 * plugins/index.js
 *
 * Automatically included in `./src/main.js`
 */

// Plugins

import common from './common'


export function registerPlugins (app, options) {
  app
    .use(common)
}
