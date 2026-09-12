const app = require("./app");
const { env } = require("./config/env");
const logger = require("./config/logger");

app.listen(env.port, () => {
  logger.info(`Sanad Review running on http://localhost:${env.port}`);
});

require("./services/scheduler").startScheduler();
