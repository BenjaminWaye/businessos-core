/**
 * Task lifecycle tests (pure — no database).
 *
 *   created -> in_progress -> completed
 *                    ↘ failed
 *                    ↘ blocked
 *
 * These commands are never called by the engine itself — only by whatever
 * actually executes a task (a human today; an execution agent in a later
 * milestone). Proves the engine's "no side effects, tasks are the only
 * output" rule holds: nothing here reaches outside this module.
 */

import { describe, expect, it } from "vitest";
import type { EventDraft } from "@businessos/kernel";
import { applyTaskResult, startTask } from "../commands.js";
import { projectWorkflows } from "../projection.js";
import type { Task } from "../types.js";
import { fixedDeps } from "./helpers.js";

const COMPANY = "acme";

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "task-1",
    type: "SendInvoiceTask",
    status: "created",
    payload: { invoiceId: "inv-1" },
    workflowInstanceId: "wf-1",
    createdAt: "2026-03-01T00:00:00.000Z",
    ...overrides,
  };
}

function fold(drafts: EventDraft[]) {
  return projectWorkflows(drafts.map((d, i) => ({ ...d, seq: i + 1 })));
}

describe("startTask", () => {
  it("created -> in_progress", () => {
    const draft = startTask(makeTask(), { companyId: COMPANY }, fixedDeps());
    expect(draft.payload).toEqual({ taskId: "task-1", status: "in_progress" });
  });

  it("rejects starting a task that isn't 'created'", () => {
    expect(() =>
      startTask(makeTask({ status: "in_progress" }), { companyId: COMPANY }, fixedDeps()),
    ).toThrow(/must be "created"/);
  });
});

describe("applyTaskResult", () => {
  it("in_progress -> completed, with output", () => {
    const task = makeTask({ status: "in_progress" });
    const draft = applyTaskResult(
      task,
      { companyId: COMPANY, result: { taskId: "task-1", status: "completed", output: { sentAt: "2026-03-02" } } },
      fixedDeps(),
    );
    expect(draft.payload).toEqual({
      taskId: "task-1",
      status: "completed",
      output: { sentAt: "2026-03-02" },
    });
  });

  it("in_progress -> failed", () => {
    const task = makeTask({ status: "in_progress" });
    const draft = applyTaskResult(
      task,
      { companyId: COMPANY, result: { taskId: "task-1", status: "failed" } },
      fixedDeps(),
    );
    expect(draft.payload.status).toBe("failed");
  });

  it("in_progress -> blocked, when the result requires human input", () => {
    const task = makeTask({ status: "in_progress" });
    const draft = applyTaskResult(
      task,
      { companyId: COMPANY, result: { taskId: "task-1", status: "requires_human_input" } },
      fixedDeps(),
    );
    expect(draft.payload.status).toBe("blocked");
  });

  it("rejects applying a result to a task that isn't in_progress", () => {
    expect(() =>
      applyTaskResult(
        makeTask({ status: "created" }),
        { companyId: COMPANY, result: { taskId: "task-1", status: "completed" } },
        fixedDeps(),
      ),
    ).toThrow(/must be "in_progress"/);
  });

  it("rejects a result whose taskId doesn't match the task", () => {
    expect(() =>
      applyTaskResult(
        makeTask({ status: "in_progress" }),
        { companyId: COMPANY, result: { taskId: "some-other-task", status: "completed" } },
        fixedDeps(),
      ),
    ).toThrow(/result is for task/);
  });
});

describe("full lifecycle folded through the projection", () => {
  it("TaskCreated + status changes fold into a consistent task record", () => {
    const deps = fixedDeps();
    const taskCreated: EventDraft = {
      id: deps.newId(),
      companyId: COMPANY,
      type: "TaskCreated",
      occurredAt: deps.now(),
      payload: { taskId: "task-1", workflowInstanceId: "wf-1", type: "SendInvoiceTask", payload: { invoiceId: "inv-1" } },
    };
    const task = makeTask();
    const inProgress = startTask(task, { companyId: COMPANY }, deps);
    const completed = applyTaskResult(
      { ...task, status: "in_progress" },
      { companyId: COMPANY, result: { taskId: "task-1", status: "completed", output: { sent: true } } },
      deps,
    );

    const state = fold([taskCreated, inProgress, completed]);
    expect(state.tasks).toHaveLength(1);
    expect(state.tasks[0]).toMatchObject({ id: "task-1", status: "completed", output: { sent: true } });
  });
});
