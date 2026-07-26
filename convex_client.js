const fs = require('fs');
const path = require('path');

let useConvex = false;
let convexClient = null;
const memoryFilePath = path.join(__dirname, 'jarvis_memory.json');

// Check if Convex environment variable is set
if (process.env.CONVEX_URL) {
  try {
    const { ConvexHttpClient } = require('convex/browser');
    convexClient = new ConvexHttpClient(process.env.CONVEX_URL);
    useConvex = true;
    console.log(`[Convex] Database client initialized. Routing memory to: ${process.env.CONVEX_URL}`);
  } catch (err) {
    console.warn('[Convex Warning] Failed to initialize ConvexHttpClient. Falling back to local file storage.', err);
  }
} else {
  console.log('[Convex] CONVEX_URL environment variable not detected. Using local JSON memory fallback: jarvis_memory.json');
}

// Local JSON DB Helper: read memory file
function readLocalMemory() {
  if (!fs.existsSync(memoryFilePath)) {
    fs.writeFileSync(memoryFilePath, JSON.stringify({ turns: [], states: {} }, null, 2));
  }
  try {
    const data = fs.readFileSync(memoryFilePath, 'utf8');
    return JSON.parse(data);
  } catch (err) {
    console.error('[Memory DB Error] Failed to read local memory file:', err);
    return { turns: [], states: {} };
  }
}

// Local JSON DB Helper: write memory file
function writeLocalMemory(data) {
  try {
    fs.writeFileSync(memoryFilePath, JSON.stringify(data, null, 2), 'utf8');
  } catch (err) {
    console.error('[Memory DB Error] Failed to write local memory file:', err);
  }
}

/**
 * Fetch conversation history for a given sessionId
 */
async function fetchHistory(sessionId) {
  if (useConvex) {
    try {
      // In Convex, queries are referenced as "fileName:functionName"
      const history = await convexClient.query("memory:getHistory", { sessionId });
      return history.map(t => ({ role: t.role, text: t.text, timestamp: t.timestamp }));
    } catch (err) {
      console.error('[Convex Query Error] Failed to fetch history:', err.message);
      // Fallback to local on error
    }
  }

  const memory = readLocalMemory();
  return memory.turns
    .filter(t => t.sessionId === sessionId)
    .sort((a, b) => a.timestamp - b.timestamp);
}

/**
 * Save a new conversation turn (user or assistant)
 */
async function saveTurn(sessionId, role, text) {
  if (useConvex) {
    try {
      await convexClient.mutation("memory:addTurn", { sessionId, role, text });
      return;
    } catch (err) {
      console.error('[Convex Mutation Error] Failed to save turn:', err.message);
    }
  }

  const memory = readLocalMemory();
  memory.turns.push({
    sessionId,
    role,
    text,
    timestamp: Date.now()
  });
  writeLocalMemory(memory);
}

/**
 * Fetch state (activeTask, pendingClarification, taskParameters) for a session
 */
async function fetchState(sessionId) {
  if (useConvex) {
    try {
      const state = await convexClient.query("memory:getSessionState", { sessionId });
      if (state) {
        return {
          activeTask: state.activeTask || null,
          pendingClarification: state.pendingClarification || null,
          taskParameters: state.taskParameters ? JSON.parse(state.taskParameters) : {}
        };
      }
    } catch (err) {
      console.error('[Convex Query Error] Failed to fetch session state:', err.message);
    }
  }

  const memory = readLocalMemory();
  const state = memory.states[sessionId] || {};
  return {
    activeTask: state.activeTask || null,
    pendingClarification: state.pendingClarification || null,
    taskParameters: state.taskParameters || {}
  };
}

/**
 * Save or update session state
 */
async function saveState(sessionId, stateUpdate) {
  const { activeTask, pendingClarification, taskParameters } = stateUpdate;

  if (useConvex) {
    try {
      await convexClient.mutation("memory:updateSessionState", {
        sessionId,
        activeTask: activeTask || undefined,
        pendingClarification: pendingClarification || undefined,
        taskParameters: taskParameters ? JSON.stringify(taskParameters) : undefined
      });
      return;
    } catch (err) {
      console.error('[Convex Mutation Error] Failed to save session state:', err.message);
    }
  }

  const memory = readLocalMemory();
  const current = memory.states[sessionId] || {};
  memory.states[sessionId] = {
    activeTask: activeTask !== undefined ? activeTask : current.activeTask,
    pendingClarification: pendingClarification !== undefined ? pendingClarification : current.pendingClarification,
    taskParameters: taskParameters !== undefined ? taskParameters : current.taskParameters
  };
  writeLocalMemory(memory);
}

module.exports = {
  fetchHistory,
  saveTurn,
  fetchState,
  saveState
};
