import { expect, test } from "@playwright/test";

const API = process.env.E2E_API_URL ?? "http://localhost:8000";

test.describe("Agent Studio end to end", () => {
  test("template → run with human gate → time-travel fork → compare", async ({ page, request }) => {
    // 1. create a graph from the tweet template
    const created = await request.post(`${API}/graphs/from-template/tweet-review`);
    expect(created.status()).toBe(201);
    const graph = await created.json();

    await page.goto(`/graphs/${graph.id}`);
    await expect(page.locator(".react-flow__node")).toHaveCount(6);

    // 2. run it, answer the human gate twice
    await page.getByRole("button", { name: "Run", exact: true }).click();
    await page.locator("div.fixed input").fill("why debugging AI agents matters");
    await page.keyboard.press("Enter");
    const gate = page.getByText("is waiting for you");
    await expect(gate).toBeVisible({ timeout: 60_000 });
    await page.getByRole("button", { name: "no", exact: true }).click();
    await expect(gate).toBeHidden();
    await expect(gate).toBeVisible({ timeout: 60_000 });
    await page.getByRole("button", { name: "yes", exact: true }).click();
    await expect(page.locator("header")).toContainText("done", { timeout: 60_000 });
    await expect(page.locator(".react-flow__node .lucide-check")).toHaveCount(6);

    // 3. inspect state, fork from the step after the first draft with an edited draft
    await page.getByRole("button", { name: "state" }).click();
    const steps = page.locator("aside ol li");
    await expect(steps.first()).toBeVisible();
    await steps.filter({ hasText: "after Write draft" }).first().click();
    await page.getByRole("button", { name: /Edit state & fork/ }).click();
    const editor = page.locator("aside textarea");
    const vars = JSON.parse(await editor.inputValue());
    vars.draft = "Hand-edited draft from the e2e test.";
    await editor.fill(JSON.stringify(vars, null, 2));
    await page.getByRole("button", { name: "Fork & run" }).click();
    await expect(gate).toBeVisible({ timeout: 60_000 });
    await expect(page.locator("dd").first()).toContainText("Hand-edited draft");
    await page.getByRole("button", { name: "yes", exact: true }).click();
    await expect(page.locator("header")).toContainText("done", { timeout: 60_000 });

    // 4. runs tree shows the fork, compare tab shows the parent vs fork
    await page.getByRole("button", { name: "Runs" }).click();
    await expect(page.locator("section ul li", { hasText: "⑂" })).toHaveCount(1);
    await page.getByRole("button", { name: "Compare" }).click();
    await expect(page.locator("section")).toContainText("final variables", { timeout: 20_000 });
    await expect(page.locator("section")).toContainText("Hand-edited");

    // clean up
    const runs = await (await request.get(`${API}/runs?graph_id=${graph.id}`)).json();
    expect(runs.length).toBe(2);
    await request.delete(`${API}/graphs/${graph.id}`);
  });

  test("shared link is read-only and can be copied", async ({ page, request }) => {
    const graph = await (await request.post(`${API}/graphs/from-template/pr-review`)).json();
    const { token } = await (await request.post(`${API}/graphs/${graph.id}/share`)).json();
    await page.goto(`/share/${token}`);
    await expect(page.locator("header")).toContainText("read-only");
    await expect(page.locator(".react-flow__node")).toHaveCount(7);
    await page.getByRole("button", { name: "Copy to my graphs" }).click();
    await expect(page).toHaveURL(/\/graphs\/[0-9a-f-]{36}$/);
    await expect(page.locator("header input")).toHaveValue(/\(copy\)$/);
    const copyId = page.url().split("/").pop()!;
    await request.delete(`${API}/graphs/${copyId}`);
    await request.delete(`${API}/graphs/${graph.id}`);
  });
});
