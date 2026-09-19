const app = require("./app");
const { env } = require("./config/env");
const logger = require("./config/logger");

app.listen(env.port, () => {
  logger.info(`xrepu running on http://localhost:${env.port}`);
});

require("./services/scheduler").startScheduler();
