import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

describe("D1 study tables (#13)", () => {
  it("creates the tables from migrations/", async () => {
    const { results } = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE '\\_%' ESCAPE '\\' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'd1_%' ORDER BY name",
    ).all<{ name: string }>();

    expect(results.map((row) => row.name)).toEqual(["ai_sessions", "favorites", "notes", "terms"]);
  });

  it("treats terms case-insensitively", async () => {
    const now = new Date().toISOString();
    const insert = env.DB.prepare(
      "INSERT INTO terms (word, explanation, created_at, updated_at) VALUES (?, ?, ?, ?)",
    );
    await insert.bind("RAG", "検索拡張生成", now, now).run();

    await expect(insert.bind("rag", "重複", now, now).run()).rejects.toThrow(/UNIQUE/);
  });
});
