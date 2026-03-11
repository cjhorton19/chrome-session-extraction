/**
 * content.js — Content Script
 *
 * Injected on every page (<all_urls>).
 * Captures clicks, text inputs (debounced), and change events.
 * Generates a robust CSS selector for every interacted element.
 * Sends events to background.js via chrome.runtime.sendMessage.
 */

(() => {
  "use strict";

  let isRecording = false;

  /* ---------------------------------------------------------------- */
  /*  Selector generation                                             */
  /* ---------------------------------------------------------------- */

  /**
   * Build the most robust CSS selector we can for `el`.
   * Priority: #id  →  [name]  →  unique attribute combo  →  nth-child path.
   */
  function buildSelector(el) {
    // 1. ID — most reliable
    if (el.id) {
      return `#${CSS.escape(el.id)}`;
    }

    // 2. name attribute (great for forms)
    const name = el.getAttribute("name");
    if (name) {
      const tag = el.tagName.toLowerCase();
      const sel = `${tag}[name="${CSS.escape(name)}"]`;
      if (document.querySelectorAll(sel).length === 1) return sel;
    }

    // 3. data-testid / data-test / aria-label (automation-friendly attrs)
    for (const attr of ["data-testid", "data-test", "aria-label"]) {
      const val = el.getAttribute(attr);
      if (val) {
        const tag = el.tagName.toLowerCase();
        const sel = `${tag}[${attr}="${CSS.escape(val)}"]`;
        if (document.querySelectorAll(sel).length === 1) return sel;
      }
    }

    // 4. type + placeholder for inputs
    if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") {
      const type = el.getAttribute("type") || "text";
      const ph = el.getAttribute("placeholder");
      if (ph) {
        const sel = `${el.tagName.toLowerCase()}[type="${type}"][placeholder="${CSS.escape(ph)}"]`;
        if (document.querySelectorAll(sel).length === 1) return sel;
      }
    }

    // 5. Fallback — nth-child path from body
    return nthChildPath(el);
  }

  /** Walk up the DOM and build an nth-child selector path. */
  function nthChildPath(el) {
    const parts = [];
    let current = el;
    while (current && current !== document.body && current !== document.documentElement) {
      const tag = current.tagName.toLowerCase();
      const parent = current.parentElement;
      if (!parent) break;

      const siblings = Array.from(parent.children).filter(
        (c) => c.tagName === current.tagName
      );
      if (siblings.length === 1) {
        parts.unshift(tag);
      } else {
        const idx = siblings.indexOf(current) + 1;
        parts.unshift(`${tag}:nth-of-type(${idx})`);
      }
      current = parent;
    }
    return parts.join(" > ");
  }

  /* ---------------------------------------------------------------- */
  /*  Element context extraction                                      */
  /* ---------------------------------------------------------------- */

  function elementContext(el) {
    const tag = el.tagName.toLowerCase();
    const ctx = {
      element: tag,
      selector: buildSelector(el),
    };

    if (el.id) ctx.id = el.id;
    if (el.className && typeof el.className === "string") {
      ctx.classes = el.className.trim().split(/\s+/).filter(Boolean);
    }

    // Text content (trim + cap at 120 chars)
    const text = (el.innerText || "").trim().slice(0, 120);
    if (text) ctx.text = text;

    // Value
    if (el.value !== undefined && el.value !== "") ctx.value = el.value;

    // Placeholder
    const ph = el.getAttribute("placeholder");
    if (ph) ctx.placeholder = ph;

    // Input type
    const type = el.getAttribute("type");
    if (type) ctx.inputType = type;

    // Href (for links)
    if (el.href) ctx.href = el.href;

    // URL where the action occurred
    ctx.url = location.href;

    return ctx;
  }

  /* ---------------------------------------------------------------- */
  /*  Sensitive field detection (NEVER capture credentials)            */
  /* ---------------------------------------------------------------- */

  /**
   * Keywords that indicate a field is related to authentication.
   * Matched case-insensitively against name, id, autocomplete,
   * placeholder, and aria-label attributes.
   */
  const SENSITIVE_KEYWORDS = [
    "password", "passwd", "pass", "pwd",
    "username", "user_name", "user-name", "userid", "user_id", "user-id",
    "login", "signin", "sign-in", "sign_in",
    "credential", "secret", "token", "api_key", "apikey", "api-key",
    "otp", "one-time", "onetime", "totp", "mfa", "2fa",
    "ssn", "social-security", "social_security",
    "credit-card", "credit_card", "creditcard",
    "card-number", "card_number", "cardnumber",
    "cvv", "cvc", "csc", "security-code", "security_code",
  ];

  /** Input types that are inherently sensitive. */
  const SENSITIVE_TYPES = new Set(["password"]);

  /** Autocomplete tokens that are sensitive. */
  const SENSITIVE_AUTOCOMPLETE = new Set([
    "current-password", "new-password",
    "username", "email",
    "one-time-code",
    "cc-number", "cc-csc", "cc-exp", "cc-exp-month", "cc-exp-year", "cc-name",
  ]);

  /**
   * Returns true if `el` (or any ancestor input/form-field it belongs to)
   * is a credential / sensitive field. When true the event MUST be dropped.
   */
  function isSensitiveField(el) {
    // Walk up to find the actual input/textarea/select if we clicked a child.
    const field = el.closest("input, textarea, select") || el;

    // 1. Check type attribute.
    const type = (field.getAttribute("type") || "").toLowerCase();
    if (SENSITIVE_TYPES.has(type)) return true;

    // 2. Check autocomplete attribute.
    const ac = (field.getAttribute("autocomplete") || "").toLowerCase();
    if (SENSITIVE_AUTOCOMPLETE.has(ac)) return true;

    // 3. Keyword scan across name, id, placeholder, aria-label.
    const haystack = [
      field.getAttribute("name"),
      field.id,
      field.getAttribute("placeholder"),
      field.getAttribute("aria-label"),
      field.getAttribute("autocomplete"),
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    for (const kw of SENSITIVE_KEYWORDS) {
      if (haystack.includes(kw)) return true;
    }

    return false;
  }

  /* ---------------------------------------------------------------- */
  /*  Send event to background                                        */
  /* ---------------------------------------------------------------- */

  function send(payload) {
    if (!isRecording) return;
    try {
      chrome.runtime.sendMessage({ type: "RECORD_EVENT", payload });
    } catch {
      // Extension context invalidated (page outlived SW). Silently ignore.
    }
  }

  /* ---------------------------------------------------------------- */
  /*  Click handler                                                    */
  /* ---------------------------------------------------------------- */

  document.addEventListener(
    "click",
    (e) => {
      if (!isRecording) return;
      const el = e.target.closest(
        "a, button, input[type='submit'], input[type='button'], [role='button'], label, select, summary, details"
      ) || e.target;

      // NEVER capture clicks on sensitive / credential fields.
      if (isSensitiveField(el)) return;

      send({
        action: "click",
        ...elementContext(el),
      });
    },
    true // capture phase — fires before the page's own handlers
  );

  /* ---------------------------------------------------------------- */
  /*  Input handler (debounced)                                        */
  /* ---------------------------------------------------------------- */

  const inputTimers = new WeakMap();

  function handleInput(e) {
    if (!isRecording) return;
    const el = e.target;
    if (!el || !("value" in el)) return;

    // NEVER capture input into sensitive / credential fields.
    if (isSensitiveField(el)) return;

    // Clear previous debounce timer for this element.
    const prev = inputTimers.get(el);
    if (prev) clearTimeout(prev);

    const timer = setTimeout(() => {
      inputTimers.delete(el);
      send({
        action: "input",
        ...elementContext(el),
        value: el.value,
      });
    }, 300);

    inputTimers.set(el, timer);
  }

  document.addEventListener("input", handleInput, true);

  /* ---------------------------------------------------------------- */
  /*  Change handler (selects, checkboxes, radios)                     */
  /* ---------------------------------------------------------------- */

  document.addEventListener(
    "change",
    (e) => {
      if (!isRecording) return;
      const el = e.target;
      if (!el) return;

      // NEVER capture changes on sensitive / credential fields.
      if (isSensitiveField(el)) return;

      const payload = {
        action: "change",
        ...elementContext(el),
      };

      // For checkboxes / radios include checked state.
      if (el.type === "checkbox" || el.type === "radio") {
        payload.checked = el.checked;
      }

      // For <select> include the selected option text.
      if (el.tagName === "SELECT") {
        const opt = el.options[el.selectedIndex];
        payload.selectedText = opt ? opt.textContent.trim() : "";
        payload.value = el.value;
      }

      send(payload);
    },
    true
  );

  /* ---------------------------------------------------------------- */
  /*  Recording state sync                                             */
  /* ---------------------------------------------------------------- */

  // Query initial state.
  try {
    chrome.runtime.sendMessage({ type: "GET_STATE" }, (res) => {
      if (res) isRecording = res.isRecording;
    });
  } catch {
    // Ignore if SW is not ready yet.
  }

  // Listen for storage changes so the flag stays in sync.
  chrome.storage.onChanged.addListener((changes) => {
    if (changes.isRecording) {
      isRecording = changes.isRecording.newValue;
    }
  });
})();
