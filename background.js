/**
 * background.js — Service Worker (Manifest V3)
 *
 * Responsibilities:
 *  1. Maintain recording state (isRecording) in chrome.storage.local.
 *  2. Listen for navigation events via chrome.webNavigation.onCompleted.
 *  3. Receive click / input messages from content.js.
 *  4. Append every event as a numbered step to recordedSteps in storage.
 */

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

/** Return a short HH:MM:SS timestamp string. */
function timestamp() {
  const d = new Date();
  return d.toTimeString().split(" ")[0]; // "HH:MM:SS"
}

/** Append a new step object to storage and return the updated array. */
async function appendStep(stepData) {
  const { recordedSteps = [] } = await chrome.storage.local.get("recordedSteps");
  const step = {
    step: recordedSteps.length + 1,
    timestamp: timestamp(),
    ...stepData,
  };
  recordedSteps.push(step);
  await chrome.storage.local.set({ recordedSteps });
  return recordedSteps;
}

/* ------------------------------------------------------------------ */
/*  Navigation listener                                               */
/* ------------------------------------------------------------------ */

chrome.webNavigation.onCompleted.addListener(async (details) => {
  // Only record top-level frame navigations.
  if (details.frameId !== 0) return;

  const { isRecording } = await chrome.storage.local.get("isRecording");
  if (!isRecording) return;

  await appendStep({
    action: "navigate",
    url: details.url,
  });
});

/* ------------------------------------------------------------------ */
/*  Message listener (click / input from content script)              */
/* ------------------------------------------------------------------ */

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "RECORD_EVENT") {
    (async () => {
      const { isRecording } = await chrome.storage.local.get("isRecording");
      if (!isRecording) {
        sendResponse({ recorded: false });
        return;
      }
      await appendStep(message.payload);
      sendResponse({ recorded: true });
    })();
    return true; // keep the message channel open for async sendResponse
  }

  if (message.type === "GET_STATE") {
    chrome.storage.local.get(["isRecording"], (result) => {
      sendResponse({ isRecording: !!result.isRecording });
    });
    return true;
  }

  if (message.type === "SET_RECORDING") {
    chrome.storage.local.set({ isRecording: message.value }, () => {
      sendResponse({ isRecording: message.value });
    });
    return true;
  }
});

/* ------------------------------------------------------------------ */
/*  Initialise state on install / update                              */
/* ------------------------------------------------------------------ */

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get(["isRecording", "recordedSteps"], (result) => {
    const defaults = {};
    if (result.isRecording === undefined) defaults.isRecording = false;
    if (result.recordedSteps === undefined) defaults.recordedSteps = [];
    if (Object.keys(defaults).length) chrome.storage.local.set(defaults);
  });
});
