import express from "express";

export function createApp() {
  const app = express();

  app.use(express.json());

  app.get("/health", (_request, response) => {
    response.json({ ok: true });
  });

  return app;
}

