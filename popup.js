/**
 * popup.js — Popup controller
 *
 * Reads & renders recording state and recorded steps.
 * Provides Start/Stop, Copy, and Clear controls.
 */

(() => {
  "use strict";

  const toggleBtn    = document.getElementById("toggleBtn");
  const copyBtn      = document.getElementById("copyBtn");
  const clearBtn     = document.getElementById("clearBtn");
  const outputEl     = document.getElementById("output");
  const stepCountEl  = document.getElementById("stepCount");
  const statusBadge  = document.getElementById("statusBadge");
  const toast        = document.getElementById("toast");

  let recording = false;

  /* ---------------------------------------------------------------- */
  /*  UI helpers                                                       */
  /* ---------------------------------------------------------------- */

  function setRecordingUI(on) {
    recording = on;
    toggleBtn.textContent = on ? "Stop Recording" : "Start Recording";
    toggleBtn.classList.toggle("stop", on);
    statusBadge.textContent = on ? "Recording" : "Idle";
    statusBadge.className   = "badge " + (on ? "recording" : "idle");
  }

  function renderSteps(steps) {
    outputEl.textContent = JSON.stringify(steps, null, 2);
    stepCountEl.textContent = steps.length;
  }

  function showToast(msg) {
    toast.textContent = msg;
    toast.classList.add("show");
    setTimeout(() => toast.classList.remove("show"), 1800);
  }

  /* ---------------------------------------------------------------- */
  /*  Initialise on popup open                                         */
  /* ---------------------------------------------------------------- */

  chrome.storage.local.get(["isRecording", "recordedSteps"], (result) => {
    setRecordingUI(!!result.isRecording);
    renderSteps(result.recordedSteps || []);
  });

  // Live-update the JSON view while the popup is open.
  chrome.storage.onChanged.addListener((changes) => {
    if (changes.recordedSteps) {
      renderSteps(changes.recordedSteps.newValue || []);
    }
    if (changes.isRecording) {
      setRecordingUI(changes.isRecording.newValue);
    }
  });

  /* ---------------------------------------------------------------- */
  /*  Toggle recording                                                 */
  /* ---------------------------------------------------------------- */

  toggleBtn.addEventListener("click", () => {
    const newState = !recording;
    chrome.runtime.sendMessage({ type: "SET_RECORDING", value: newState }, () => {
      setRecordingUI(newState);
    });
  });

  /* ---------------------------------------------------------------- */
  /*  Copy to clipboard                                                */
  /* ---------------------------------------------------------------- */

  copyBtn.addEventListener("click", async () => {
    const { recordedSteps = [] } = await chrome.storage.local.get("recordedSteps");
    const json = JSON.stringify(recordedSteps, null, 2);
    await navigator.clipboard.writeText(json);
    showToast("Copied to clipboard!");
  });

  /* ---------------------------------------------------------------- */
  /*  Clear recorded steps                                             */
  /* ---------------------------------------------------------------- */

  clearBtn.addEventListener("click", () => {
    chrome.storage.local.set({ recordedSteps: [] }, () => {
      renderSteps([]);
      showToast("Cleared");
    });
  });
})();
