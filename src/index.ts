import { createApp } from "./api/app.js";
import { env } from "./config/env.js";

const app = createApp();

app.listen(env.port, () => {
  console.log(`career-job-agent listening on port ${env.port}`);
});
