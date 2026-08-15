import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/api/app.js";

describe("GET /health", () => {
  const app = createApp();

  it("starts the app and returns status ok", async () => {
    const response = await request(app).get("/health");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: "ok", service: "career-job-agent" });
  });
});
