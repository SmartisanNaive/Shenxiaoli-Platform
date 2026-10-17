import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../src/app";
import { createDatabase } from "../src/db";

test("uploaded images are readable by signed-in browsers and private to guests", async () => {
  const directory = mkdtempSync(join(tmpdir(), "shenxiaoli-images-"));
  const db = createDatabase({ path: ":memory:", seedDemoUsers: true });
  try {
    const app = createApp({
      database: db,
      demoAuthEnabled: true,
      uploadsDir: directory,
    });
    const login = await app.request("/api/auth/demo", { method: "POST" });
    const cookie = login.headers.get("set-cookie")!.split(";")[0];
    const bytes = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl6kAAAAASUVORK5CYII=",
      "base64",
    );
    const body = new FormData();
    body.set("file", new File([bytes], "test.png", { type: "image/png" }));
    const uploaded = await app.request("/api/uploads", {
      method: "POST",
      headers: { cookie },
      body,
    });
    expect(uploaded.status).toBe(201);
    const { url } = (await uploaded.json()) as { url: string };
    const image = await app.request(url, { headers: { cookie } });
    expect(image.status).toBe(200);
    expect(Buffer.from(await image.arrayBuffer())).toEqual(bytes);
    expect(image.headers.get("cache-control")).toBe("private, no-store");
    expect((await app.request(url)).status).toBe(401);
    expect(login.headers.get("set-cookie")).toMatch(/Path=\/(?:;|$)/);
    expect(
      (await app.request("/uploads/no-file.png", { headers: { cookie } }))
        .status,
    ).toBe(404);
  } finally {
    db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
