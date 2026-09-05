(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.NESTCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const TASK_FIELDS = ["title", "assignee", "done", "deleted", "labels", "dependsOn"];
  const LOGICAL_PREFIX = "L:";

  function byId(tasks) {
    return new Map((tasks || []).map(task => [task.id, task]));
  }

  function taskState(tasks, task) {
    if (!task) return "ready";
    if (task.done) return "done";
    const map = byId(tasks);
    const waiting = (task.dependsOn || []).some(id => {
      const prerequisite = map.get(id);
      return prerequisite && !prerequisite.deleted && !prerequisite.done;
    });
    return waiting ? "waiting" : "ready";
  }

  function unresolvedDependencies(tasks, task) {
    const map = byId(tasks);
    return (task?.dependsOn || [])
      .map(id => map.get(id))
      .filter(item => item && !item.deleted && !item.done);
  }

  function wouldCreateCycle(tasks, taskId, dependencyId) {
    if (!taskId || !dependencyId) return false;
    if (taskId === dependencyId) return true;
    const map = byId(tasks);
    const stack = [dependencyId];
    const visited = new Set();
    while (stack.length) {
      const current = stack.pop();
      if (current === taskId) return true;
      if (visited.has(current)) continue;
      visited.add(current);
      const task = map.get(current);
      if (task && !task.deleted) stack.push(...(task.dependsOn || []));
    }
    return false;
  }

  function parseClock(value) {
    const raw = typeof value === "string" ? value : "";
    if (raw.startsWith(LOGICAL_PREFIX)) {
      const match = /^L:(\d{1,16}):(.+)$/.exec(raw);
      if (match) {
        return { kind: "logical", counter: Number(match[1]) || 0, node: match[2], raw };
      }
    }
    const millis = Date.parse(raw);
    if (Number.isFinite(millis)) return { kind: "legacy", millis, raw };
    return { kind: "empty", raw };
  }

  function compareClock(left, right) {
    const a = parseClock(left);
    const b = parseClock(right);
    if (a.kind === "logical" && b.kind !== "logical") return 1;
    if (b.kind === "logical" && a.kind !== "logical") return -1;
    if (a.kind === "logical" && b.kind === "logical") {
      if (a.counter !== b.counter) return a.counter > b.counter ? 1 : -1;
      return a.node.localeCompare(b.node);
    }
    if (a.kind === "legacy" && b.kind === "legacy") {
      if (a.millis !== b.millis) return a.millis > b.millis ? 1 : -1;
      return a.raw.localeCompare(b.raw);
    }
    if (a.kind === "legacy") return 1;
    if (b.kind === "legacy") return -1;
    return a.raw.localeCompare(b.raw);
  }

  function logicalCounter(value) {
    const parsed = parseClock(value);
    return parsed.kind === "logical" ? parsed.counter : 0;
  }

  function makeLogicalClock(counter, nodeId) {
    const safeCounter = Math.max(0, Math.floor(Number(counter) || 0));
    const safeNode = String(nodeId || "unknown").replace(/\s+/g, "_");
    return `${LOGICAL_PREFIX}${String(safeCounter).padStart(16, "0")}:${safeNode}`;
  }

  function normalizeFieldClock(task, field) {
    const explicit = task?.fieldUpdatedAt?.[field];
    if (typeof explicit === "string" && explicit) return explicit;
    return typeof task?.updatedAt === "string" ? task.updatedAt : "";
  }

  function mergeById(left, right, dateField = "createdAt") {
    const map = new Map((left || []).map(item => [item.id, item]));
    for (const item of right || []) {
      const existing = map.get(item.id);
      if (!existing || String(item?.[dateField] || "") > String(existing?.[dateField] || "")) {
        map.set(item.id, item);
      } else if (existing && String(item?.[dateField] || "") === String(existing?.[dateField] || "")) {
        const localValue = JSON.stringify(existing);
        const remoteValue = JSON.stringify(item);
        if (remoteValue > localValue) map.set(item.id, item);
      }
    }
    return [...map.values()].sort((a, b) => String(a?.[dateField] || "").localeCompare(String(b?.[dateField] || "")));
  }

  function cloneValue(value) {
    if (Array.isArray(value)) return [...value];
    if (value && typeof value === "object") return { ...value };
    return value;
  }

  function deterministicValue(left, right) {
    const leftEncoded = JSON.stringify(left);
    const rightEncoded = JSON.stringify(right);
    return rightEncoded > leftEncoded ? cloneValue(right) : cloneValue(left);
  }

  function mergeTask(localTask, remoteTask) {
    if (!localTask) return remoteTask ? structuredCloneSafe(remoteTask) : null;
    if (!remoteTask) return structuredCloneSafe(localTask);

    const merged = structuredCloneSafe(localTask);
    merged.fieldUpdatedAt = { ...(localTask.fieldUpdatedAt || {}) };
    for (const field of TASK_FIELDS) {
      const localClock = normalizeFieldClock(localTask, field);
      const remoteClock = normalizeFieldClock(remoteTask, field);
      const order = compareClock(remoteClock, localClock);
      if (order > 0) {
        merged[field] = cloneValue(remoteTask[field]);
        merged.fieldUpdatedAt[field] = remoteClock;
      } else if (order < 0) {
        merged.fieldUpdatedAt[field] = localClock;
      } else {
        merged.fieldUpdatedAt[field] = localClock || remoteClock;
        if (JSON.stringify(localTask[field]) !== JSON.stringify(remoteTask[field])) {
          merged[field] = deterministicValue(localTask[field], remoteTask[field]);
        }
      }
    }
    merged.comments = mergeById(localTask.comments || [], remoteTask.comments || [], "createdAt");
    merged.createdAt = [localTask.createdAt, remoteTask.createdAt].filter(Boolean).sort()[0] || "";
    merged.updatedAt = [localTask.updatedAt, remoteTask.updatedAt].filter(Boolean).sort().at(-1) || "";
    return merged;
  }

  function completeEnvelopeGroups(chunks) {
    const groups = new Map();
    for (const chunk of chunks || []) {
      if (!chunk || typeof chunk.id !== "string" || !chunk.id) continue;
      const total = Number(chunk.total) || 1;
      const part = Number(chunk.part) || 1;
      if (total < 1 || total > 1000 || part < 1 || part > total) continue;
      if (typeof chunk.iv !== "string" || typeof chunk.data !== "string") continue;
      let group = groups.get(chunk.id);
      if (!group) {
        group = { id: chunk.id, total, iv: chunk.iv, room: chunk.room || "", parts: new Array(total), received: 0, newestAt: "", commentIds: [] };
        groups.set(chunk.id, group);
      }
      if (group.total !== total || group.iv !== chunk.iv || group.parts.length !== total) {
        group.invalid = true;
        continue;
      }
      const index = part - 1;
      if (group.parts[index] === undefined) {
        group.parts[index] = chunk.data;
        group.received++;
      }
      if (chunk.commentId != null) group.commentIds.push(chunk.commentId);
      const stamp = String(chunk.createdAt || "");
      if (stamp > group.newestAt) group.newestAt = stamp;
    }
    return [...groups.values()]
      .filter(group => !group.invalid && group.received === group.total && group.parts.every(part => typeof part === "string"))
      .map(group => ({
        id: group.id, iv: group.iv, room: group.room, data: group.parts.join(""), newestAt: group.newestAt, commentIds: [...new Set(group.commentIds)]
      }))
      .sort((a, b) => b.newestAt.localeCompare(a.newestAt));
  }

  function structuredCloneSafe(value) {
    return JSON.parse(JSON.stringify(value));
  }

  return {
    TASK_FIELDS, LOGICAL_PREFIX, taskState, unresolvedDependencies, wouldCreateCycle, mergeById, mergeTask,
    normalizeFieldClock, compareClock, logicalCounter, makeLogicalClock, completeEnvelopeGroups
  };
});
