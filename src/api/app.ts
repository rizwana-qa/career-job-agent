import express, { type Express } from "express";
import { healthRouter } from "./routes/health.js";
import { createJobsRouter, type JobsRouterDependencies } from "./routes/jobs.js";
import { createJobsDiscoverRouter, type JobsDiscoverRouterDependencies } from "./routes/jobsDiscover.js";
import { createCareerRunRouter, type CareerRunRouterDependencies } from "./routes/careerRun.js";

export type AppDependencies = JobsRouterDependencies & JobsDiscoverRouterDependencies & CareerRunRouterDependencies;

export function createApp(deps: AppDependencies = {}): Express {
  const app = express();

  app.use(express.json({ limit: "2mb" }));
  app.use(healthRouter);
  app.use(createJobsRouter(deps));
  app.use(createJobsDiscoverRouter(deps));
  app.use(createCareerRunRouter(deps));

  return app;
}
