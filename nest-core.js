(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.NESTCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const TASK_FIELDS = ["title", "assignee", "done", "deleted", "labels", "dependsOn"];

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
      }
    }
    return [...map.values()].sort((a, b) => String(a?.[dateField] || "").localeCompare(String(b?.[dateField] || "")));
  }

  function cloneValue(value) {
    if (Array.isArray(value)) return [...value];
    if (value && typeof value === "object") return { ...value };
    return value;
  }

  function mergeTask(localTask, remoteTask) {
    if (!localTask) return remoteTask ? structuredCloneSafe(remoteTask) : null;
    if (!remoteTask) return structuredCloneSafe(localTask);

    const merged = structuredCloneSafe(localTask);
    merged.fieldUpdatedAt = { ...(localTask.fieldUpdatedAt || {}) };

    for (const field of TASK_FIELDS) {
      const localClock = normalizeFieldClock(localTask, field);
      const remoteClock = normalizeFieldClock(remoteTask, field);
      if (remoteClock > localClock) {
        merged[field] = cloneValue(remoteTask[field]);
        merged.fieldUpdatedAt[field] = remoteClock;
      } else if (localClock > remoteClock) {
        merged.fieldUpdatedAt[field] = localClock;
      } else {
        merged.fieldUpdatedAt[field] = localClock || remoteClock;
        if (field === "labels" || field === "dependsOn") {
          merged[field] = [...new Set([...(localTask[field] || []), ...(remoteTask[field] || [])])];
        }
      }
    }

    merged.comments = mergeById(localTask.comments || [], remoteTask.comments || [], "createdAt");
    merged.createdAt = [localTask.createdAt, remoteTask.createdAt].filter(Boolean).sort()[0] || "";
    merged.updatedAt = [localTask.updatedAt, remoteTask.updatedAt].filter(Boolean).sort().at(-1) || "";
    return merged;
  }

  function structuredCloneSafe(value) {
    return JSON.parse(JSON.stringify(value));
  }

  return {
    TASK_FIELDS,
    taskState,
    unresolvedDependencies,
    wouldCreateCycle,
    mergeById,
    mergeTask,
    normalizeFieldClock
  };
});
