const { fetchHistory, saveTurn, fetchState, saveState } = require('./convex_client.js');
const { searchWebAndRank } = require('./search_orchestrator.js');

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

async function callGroq(prompt, isJson = false) {
  const apiKey = process.env.GROQ_API_KEY;
  console.log(`[Groq API] Falling back to Groq Llama-3.1 model...`);

  const body = {
    model: "llama-3.1-8b-instant",
    messages: [
      { role: "user", content: prompt }
    ]
  };

  if (isJson) {
    body.response_format = { type: "json_object" };
  }

  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Groq API error ${response.status}: ${errText}`);
  }

  const data = await response.json();
  if (data.choices && data.choices[0] && data.choices[0].message) {
    return data.choices[0].message.content.trim();
  }
  throw new Error('Invalid Groq API response');
}

async function callGemini(prompt, apiKey, modelName = 'gemini-2.5-flash', isJson = false) {
  const models = [modelName, 'gemini-2.5-flash-lite', 'gemini-2.5-flash'];
  
  async function executeCall(model) {
    const config = {
      contents: [{
        parts: [{ text: prompt }]
      }],
      generationConfig: {
        thinkingConfig: { thinkingBudget: 0 }
      }
    };
    
    if (isJson) {
      config.generationConfig.responseMimeType = "application/json";
    }

    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config)
    });

    if (!response.ok) {
      const errData = await response.json();
      const errMsg = errData.error ? errData.error.message : JSON.stringify(errData);
      throw new Error(`Google API ${response.status}: ${errMsg}`);
    }

    const data = await response.json();
    if (data.candidates && data.candidates[0].content && data.candidates[0].content.parts[0].text) {
      return data.candidates[0].content.parts[0].text.trim();
    }
    throw new Error('Invalid Gemini API response');
  }

  for (let i = 0; i < models.length; i++) {
    const model = models[i];
    try {
      return await executeCall(model);
    } catch (err) {
      const isTemporary = err.message.includes('429') || err.message.includes('503') || err.message.includes('500');
      if (isTemporary) {
        if (i < models.length - 1) {
          console.warn(`[Jarvis API] Temporary error on ${model}: ${err.message}. Retrying in 1s with ${models[i+1]}...`);
          await new Promise(resolve => setTimeout(resolve, 1000));
        } else {
          console.warn(`[Jarvis API] Gemini models exhausted. Trying Groq fallback...`);
          try {
            return await callGroq(prompt, isJson);
          } catch (groqErr) {
            console.error('[Jarvis API] Groq fallback failed:', groqErr.message);
            throw err; // throw original Gemini error if Groq also fails
          }
        }
      } else {
        throw err;
      }
    }
  }
}

/**
 * Process a user turn in the Jarvis agent
 */
async function processJarvisTurn(sessionId, userMessage, customApiKey, searchContext = '') {
  const apiKey = customApiKey || GEMINI_API_KEY;

  // 1. Fetch History and State from Convex/Memory DB
  const history = await fetchHistory(sessionId);
  const state = await fetchState(sessionId);

  // 2. Format history into readable string
  let historyStr = history.map(t => `${t.role === 'user' ? 'User' : 'Jarvis'}: ${t.text}`).join('\n');
  if (!historyStr) historyStr = "(No conversation history yet)";

  // 3. Build Prompt to ask Gemini to decide on next steps
  let decisionPrompt = `You are Jarvis, a highly intelligent conversational AI assistant.
Your goal is to process the user's latest message, consider the conversation history, and decide on the next actions.`;

  if (searchContext) {
    decisionPrompt += `

We have pre-fetched web search results containing facts about the user's query:
"""
${searchContext}
"""

Using ONLY the facts above, generate the final list or answer for the user. Since the search has already been executed, do NOT return any "executeTool" command. Just formulate the final conversational response answering the user's request.`;
  } else {
    decisionPrompt += `

You have access to a tool:
- "web_search": Used to perform a web search and fetch/rank paragraphs. (Use this if the user asks you to look up information on the web, find lists of places, restaurants, news, facts, etc.)`;
  }

  decisionPrompt += `

Current Session State:
- Active Task: ${state.activeTask || "None"}
- Pending Clarification: ${state.pendingClarification || "None"}
- Collected Parameters: ${JSON.stringify(state.taskParameters)}

Conversation History:
${historyStr}

Latest User Message: "${userMessage}"

Decide what to do. You MUST respond with a JSON object containing exactly these fields:
1. "activeTask": (string or null) - Update the active task name (e.g. "list_restaurants_in_vapi").
2. "taskParameters": (object) - Update any collected parameters (e.g. { location: "vapi", cuisine: "chinese" }).
3. "clarifyingQuestion": (string or null) - If the user's request is too broad (e.g. "make a list of restaurants"), and you need more details (like cuisine, veg/non-veg, or budget) to provide a good answer, formulate a polite clarifying question in Hindi/Hinglish.
4. "executeTool": (object or null) - If you have enough details to run the task, specify the tool to execute. Format: { "name": "web_search", "query": "..." }. Set to null if searchContext is already provided above or if no search is needed yet.
5. "speechResponse": (string) - The conversational speech response to return to the user (in natural Hindi/Hinglish, under 3 sentences, no markdown/asterisks).

Format output STRICTLY as a raw JSON object. Do not include markdown formatting or backticks.`;

  console.log(`[Jarvis Logic] Sending query to Gemini...`);
  const reply = await callGemini(decisionPrompt, apiKey, 'gemini-2.5-flash', true);
  
  let decision = {};
  try {
    decision = JSON.parse(reply);
  } catch (err) {
    console.error('[Jarvis JSON Parse Error]', err, reply);
    decision = {
      activeTask: null,
      taskParameters: {},
      clarifyingQuestion: null,
      executeTool: null,
      speechResponse: "Sorry, I encountered an issue processing that query."
    };
  }

  console.log('[Jarvis Decision]', decision);

  // Save the user's turn
  await saveTurn(sessionId, 'user', userMessage);

  let finalResponseText = decision.speechResponse || "";
  let executedToolInfo = null;
  
  // If tool execution is requested
  if (decision.executeTool && decision.executeTool.name === 'web_search') {
    const searchQuery = decision.executeTool.query;
    console.log(`[Jarvis Tool] Executing web_search for: "${searchQuery}"`);
    executedToolInfo = { name: 'web_search', query: searchQuery };
    
    // Execute search orchestrator RAG
    const secondSearchContext = await searchWebAndRank(searchQuery);
    
    // Feed search context to Gemini for the final response
    const finalPrompt = `You are Jarvis, a helpful voice assistant.
The user asked: "${userMessage}".
Here is the web search context containing facts retrieved from the internet:
"""
${secondSearchContext}
"""
Based ONLY on the facts above, generate a polite, conversational answer in natural Hindi/Hinglish. Keep it brief and under 3 sentences as it will be spoken back to the user. Do not use asterisks, markdown, or bullet points.

Response:`;

    console.log('[Jarvis RAG] Generating final grounded answer...');
    finalResponseText = await callGemini(finalPrompt, apiKey, 'gemini-2.5-flash');
    
    // Reset active task since it is completed
    await saveState(sessionId, {
      activeTask: null,
      pendingClarification: null,
      taskParameters: {}
    });
  } else {
    // If we completed the task using the pre-fetched searchContext, reset active task
    if (searchContext && !decision.clarifyingQuestion) {
      await saveState(sessionId, {
        activeTask: null,
        pendingClarification: null,
        taskParameters: {}
      });
    } else {
      // Save current session state (e.g. active task, pending questions, parameters)
      await saveState(sessionId, {
        activeTask: decision.activeTask,
        pendingClarification: decision.clarifyingQuestion,
        taskParameters: decision.taskParameters
      });
    }
  }

  // Save Jarvis's response turn
  await saveTurn(sessionId, 'assistant', finalResponseText);

  return {
    response: finalResponseText,
    activeTask: searchContext && !decision.clarifyingQuestion ? null : decision.activeTask,
    pendingClarification: searchContext && !decision.clarifyingQuestion ? null : decision.clarifyingQuestion,
    taskParameters: searchContext && !decision.clarifyingQuestion ? {} : decision.taskParameters,
    executedTool: executedToolInfo
  };
}

module.exports = { processJarvisTurn };
