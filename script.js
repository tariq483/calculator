/* ==========================================================================
   Smart Calculator — script.js
   Vanilla JS. No dependencies. Sections:
     1. Utilities & expression evaluator
     2. Theme
     3. Navigation (views + standard/scientific mode)
     4. Main calculator (state, keypad, keyboard)
     5. History (localStorage)
     6. Percentage tool
     7. Discount tool
   ========================================================================== */

(function () {
  "use strict";

  /* ------------------------------------------------------------------ *
   * 1. Utilities & expression evaluator
   * ------------------------------------------------------------------ */

  const OPERATORS = {
    "+": { precedence: 1, fn: (a, b) => a + b },
    "−": { precedence: 1, fn: (a, b) => a - b },
    "×": { precedence: 2, fn: (a, b) => a * b },
    "÷": { precedence: 2, fn: (a, b) => a / b },
    "^": { precedence: 3, fn: (a, b) => Math.pow(a, b), rightAssoc: true },
  };

  /**
   * Split a token list (numbers + operator/paren symbols) into an array
   * ready for the shunting-yard conversion. Tokens are already atomic
   * strings, so this mainly validates and normalizes them.
   */
  function toRPN(tokens) {
    const output = [];
    const stack = [];

    tokens.forEach((token) => {
      if (token === "(") {
        stack.push(token);
      } else if (token === ")") {
        while (stack.length && stack[stack.length - 1] !== "(") {
          output.push(stack.pop());
        }
        stack.pop(); // discard "("
      } else if (OPERATORS[token]) {
        const op = OPERATORS[token];
        while (
          stack.length &&
          OPERATORS[stack[stack.length - 1]] &&
          (OPERATORS[stack[stack.length - 1]].precedence > op.precedence ||
            (OPERATORS[stack[stack.length - 1]].precedence === op.precedence && !op.rightAssoc))
        ) {
          output.push(stack.pop());
        }
        stack.push(token);
      } else {
        // numeric literal
        output.push(token);
      }
    });

    while (stack.length) output.push(stack.pop());
    return output;
  }

  /** Evaluate an RPN token list. Throws on division by zero or malformed input. */
  function evalRPN(rpn) {
    const stack = [];
    rpn.forEach((token) => {
      if (OPERATORS[token]) {
        const b = stack.pop();
        const a = stack.pop();
        if (a === undefined || b === undefined) throw new Error("Malformed expression");
        if (token === "÷" && b === 0) throw new Error("DIVZERO");
        stack.push(OPERATORS[token].fn(a, b));
      } else {
        const n = parseFloat(token);
        if (Number.isNaN(n)) throw new Error("Malformed expression");
        stack.push(n);
      }
    });
    if (stack.length !== 1) throw new Error("Malformed expression");
    return stack[0];
  }

  /** Evaluate a full token list (numbers as strings + operator/paren symbols). */
  function evaluateTokens(tokens) {
    if (!tokens.length) return 0;
    const rpn = toRPN(tokens);
    return evalRPN(rpn);
  }

  /** Format a number for display: trims floating point noise, adds thousands separators. */
  function formatNumber(value) {
    if (!Number.isFinite(value)) return "Error";
    // Round to 10 significant decimal places to avoid float noise (0.1+0.2)
    const rounded = Math.round((value + Number.EPSILON) * 1e10) / 1e10;
    const parts = rounded.toString().split(".");
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    return parts.join(".");
  }

  /** Plain formatting (no thousands separators) used while typing. */
  function stripTrailingZeros(str) {
    return str;
  }

  /* ------------------------------------------------------------------ *
   * 2. Theme
   * ------------------------------------------------------------------ */

  const THEME_KEY = "smartcalc_theme";
  const root = document.documentElement;
  const themeToggle = document.getElementById("themeToggle");

  function applyTheme(theme) {
    if (theme === "dark") {
      root.setAttribute("data-theme", "dark");
      themeToggle.setAttribute("aria-pressed", "true");
      themeToggle.setAttribute("aria-label", "Switch to light mode");
    } else {
      root.setAttribute("data-theme", "light");
      themeToggle.setAttribute("aria-pressed", "false");
      themeToggle.setAttribute("aria-label", "Switch to dark mode");
    }
  }

  function initTheme() {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === "dark" || saved === "light") {
      applyTheme(saved);
      return;
    }
    const prefersDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
    applyTheme(prefersDark ? "dark" : "light");
  }

  themeToggle.addEventListener("click", () => {
    const isDark = root.getAttribute("data-theme") === "dark";
    const next = isDark ? "light" : "dark";
    applyTheme(next);
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch (e) {
      /* localStorage unavailable — theme just won't persist */
    }
  });

  initTheme();

  /* ------------------------------------------------------------------ *
   * 3. Navigation (views + standard/scientific mode)
   * ------------------------------------------------------------------ */

  const navLinks = document.querySelectorAll(".nav-link");
  const views = document.querySelectorAll("[data-view]");

  function showView(name) {
    views.forEach((section) => {
      section.hidden = section.dataset.view !== name;
    });
    navLinks.forEach((link) => {
      const active = link.dataset.nav === name;
      link.classList.toggle("is-active", active);
      link.setAttribute("aria-selected", String(active));
    });
  }

  navLinks.forEach((link) => {
    link.addEventListener("click", () => showView(link.dataset.nav));
  });

  const modePills = document.querySelectorAll(".mode-pill");
  const sciRow = document.getElementById("sciRow");

  function setCalcMode(mode) {
    modePills.forEach((pill) => {
      const active = pill.dataset.mode === mode;
      pill.classList.toggle("is-active", active);
      pill.setAttribute("aria-selected", String(active));
    });
    sciRow.classList.toggle("is-visible", mode === "scientific");
  }

  modePills.forEach((pill) => {
    pill.addEventListener("click", () => setCalcMode(pill.dataset.mode));
  });

  // Nav shortcuts: "Scientific" nav link jumps to Calculator view in scientific mode.
  document.querySelector('[data-nav="scientific"]').addEventListener("click", () => {
    showView("calculator");
    setCalcMode("scientific");
    document.querySelector('[data-nav="calculator"]').classList.add("is-active");
    document.querySelector('[data-nav="scientific"]').classList.remove("is-active");
  });

  /* ------------------------------------------------------------------ *
   * 4. Main calculator
   * ------------------------------------------------------------------ */

  const expressionEl = document.getElementById("expression");
  const resultEl = document.getElementById("result");
  const errorEl = document.getElementById("errorLine");
  const keypad = document.getElementById("keypad");
  const sciRowEl = document.getElementById("sciRow");

  const calc = {
    tokens: [], // committed numbers/operators/parens, each a string
    current: "", // number currently being typed
    justEvaluated: false, // true right after "="
    openParens: 0,
  };

  function resetCalc() {
    calc.tokens = [];
    calc.current = "";
    calc.justEvaluated = false;
    calc.openParens = 0;
    setError("");
    render();
  }

  function setError(message) {
    errorEl.textContent = message || "";
  }

  function render() {
    const exprParts = calc.tokens.slice();
    if (calc.current !== "") exprParts.push(calc.current);
    expressionEl.textContent = exprParts.length ? exprParts.join(" ") : "\u00A0";

    if (calc.current !== "") {
      resultEl.textContent = calc.current;
    } else if (calc.tokens.length) {
      const last = calc.tokens[calc.tokens.length - 1];
      resultEl.textContent = OPERATORS[last] || last === "(" || last === ")" ? resultEl.textContent : last;
    } else {
      resultEl.textContent = "0";
    }
  }

  function inputDigit(d) {
    setError("");
    if (calc.justEvaluated) {
      // Starting a fresh calculation after "="
      calc.tokens = [];
      calc.current = "";
      calc.justEvaluated = false;
    }
    if (calc.current === "0") calc.current = "";
    calc.current += d;
    render();
  }

  function inputDecimal() {
    setError("");
    if (calc.justEvaluated) {
      calc.tokens = [];
      calc.current = "";
      calc.justEvaluated = false;
    }
    if (calc.current === "") calc.current = "0";
    if (!calc.current.includes(".")) calc.current += ".";
    render();
  }

  function inputOperator(symbol) {
    setError("");
    if (calc.justEvaluated) {
      // Continue from the previous result
      calc.tokens = [calc.current || resultEl.textContent.replace(/,/g, "")];
      calc.current = "";
      calc.justEvaluated = false;
    }
    if (calc.current !== "") {
      calc.tokens.push(calc.current);
      calc.current = "";
    } else if (calc.tokens.length && OPERATORS[calc.tokens[calc.tokens.length - 1]]) {
      // Replace a just-entered operator instead of stacking another one
      calc.tokens.pop();
    } else if (!calc.tokens.length) {
      return; // nothing to operate on yet
    }
    calc.tokens.push(symbol);
    render();
  }

  function inputParen(symbol) {
    setError("");
    if (calc.justEvaluated) {
      calc.tokens = [];
      calc.current = "";
      calc.justEvaluated = false;
    }
    if (symbol === "(") {
      if (calc.current !== "") {
        calc.tokens.push(calc.current);
        calc.tokens.push("×"); // implicit multiplication, e.g. 2(3+4)
        calc.current = "";
      }
      calc.tokens.push("(");
      calc.openParens += 1;
    } else {
      if (calc.openParens <= 0) return; // no matching "(" to close
      if (calc.current !== "") {
        calc.tokens.push(calc.current);
        calc.current = "";
      }
      calc.tokens.push(")");
      calc.openParens -= 1;
    }
    render();
  }

  function inputConstant(name) {
    setError("");
    if (calc.justEvaluated) {
      calc.tokens = [];
      calc.justEvaluated = false;
    }
    calc.current = name === "pi" ? String(Math.PI) : String(Math.E);
    render();
  }

  function toggleSign() {
    setError("");
    if (calc.current !== "") {
      calc.current = calc.current.startsWith("-") ? calc.current.slice(1) : "-" + calc.current;
    } else if (calc.tokens.length && !OPERATORS[calc.tokens[calc.tokens.length - 1]]) {
      const last = calc.tokens.pop();
      calc.tokens.push(last.startsWith("-") ? last.slice(1) : "-" + last);
    }
    render();
  }

  function applyPercent() {
    setError("");
    if (calc.current !== "") {
      calc.current = String(parseFloat(calc.current) / 100);
    } else if (calc.tokens.length && !OPERATORS[calc.tokens[calc.tokens.length - 1]]) {
      const last = parseFloat(calc.tokens.pop());
      calc.tokens.push(String(last / 100));
    }
    render();
  }

  function backspace() {
    setError("");
    if (calc.justEvaluated) {
      resetCalc();
      return;
    }
    if (calc.current !== "") {
      calc.current = calc.current.slice(0, -1);
    } else if (calc.tokens.length) {
      const popped = calc.tokens.pop();
      if (popped === "(") calc.openParens -= 1;
      if (popped === ")") calc.openParens += 1;
    }
    render();
  }

  /** Apply a unary scientific function directly to the current value. */
  function applyUnary(kind, fnName) {
    setError("");
    const source = calc.current !== "" ? calc.current : calc.tokens.length ? calc.tokens[calc.tokens.length - 1] : resultEl.textContent.replace(/,/g, "");
    const value = parseFloat(source);
    if (Number.isNaN(value)) return;

    let out;
    try {
      switch (kind) {
        case "sqrt":
          if (value < 0) throw new Error("Cannot take the square root of a negative number");
          out = Math.sqrt(value);
          break;
        case "sq":
          out = Math.pow(value, 2);
          break;
        case "recip":
          if (value === 0) throw new Error("Cannot divide by zero");
          out = 1 / value;
          break;
        case "sci": {
          const rad = value; // degrees would need conversion; use radians for sin/cos/tan
          switch (fnName) {
            case "sin":
              out = Math.sin(rad);
              break;
            case "cos":
              out = Math.cos(rad);
              break;
            case "tan":
              out = Math.tan(rad);
              break;
            case "log":
              if (value <= 0) throw new Error("Log is undefined for values ≤ 0");
              out = Math.log10(value);
              break;
            case "ln":
              if (value <= 0) throw new Error("Ln is undefined for values ≤ 0");
              out = Math.log(value);
              break;
            default:
              return;
          }
          break;
        }
        default:
          return;
      }
    } catch (err) {
      setError(err.message);
      return;
    }

    // Replace whichever source the value came from.
    if (calc.current !== "") {
      calc.current = String(out);
    } else if (calc.tokens.length) {
      calc.tokens[calc.tokens.length - 1] = String(out);
    } else {
      calc.current = String(out);
    }
    render();
  }

  function calculate() {
    setError("");
    const tokens = calc.tokens.slice();
    if (calc.current !== "") tokens.push(calc.current);
    if (!tokens.length) return;

    // Auto-close any open parentheses so "2×(3+4" still evaluates.
    for (let i = 0; i < calc.openParens; i++) tokens.push(")");

    let value;
    try {
      value = evaluateTokens(tokens);
      if (typeof value !== "number" || Number.isNaN(value)) throw new Error("Invalid calculation");
      if (!Number.isFinite(value)) throw new Error("DIVZERO");
    } catch (err) {
      setError(err.message === "DIVZERO" ? "Cannot divide by zero" : "Invalid expression");
      return;
    }

    const exprText = tokens.join(" ");
    resultEl.textContent = formatNumber(value);
    expressionEl.textContent = exprText + " =";
    addHistory(exprText, formatNumber(value));

    calc.tokens = [];
    calc.current = String(value);
    calc.openParens = 0;
    calc.justEvaluated = true;
  }

  // Keypad click handling (event delegation)
  function handleKeyAction(action, el) {
    switch (action) {
      case "number":
        inputDigit(el.dataset.value);
        break;
      case "decimal":
        inputDecimal();
        break;
      case "operator":
        inputOperator(el.dataset.value);
        break;
      case "paren":
        inputParen(el.dataset.value);
        break;
      case "const":
        inputConstant(el.dataset.value);
        break;
      case "sign":
        toggleSign();
        break;
      case "percent":
        applyPercent();
        break;
      case "backspace":
        backspace();
        break;
      case "clear":
        resetCalc();
        break;
      case "equals":
        calculate();
        break;
      case "sqrt":
        applyUnary("sqrt");
        break;
      case "sq":
        applyUnary("sq");
        break;
      case "recip":
        applyUnary("recip");
        break;
      case "pow":
        inputOperator("^");
        break;
      case "sci":
        applyUnary("sci", el.dataset.fn);
        break;
      default:
        break;
    }
  }

  function flash(el) {
    el.classList.add("is-flashing");
    setTimeout(() => el.classList.remove("is-flashing"), 120);
  }

  keypad.addEventListener("click", (e) => {
    const btn = e.target.closest(".key");
    if (!btn) return;
    flash(btn);
    handleKeyAction(btn.dataset.action, btn);
  });

  sciRowEl.addEventListener("click", (e) => {
    const btn = e.target.closest(".key");
    if (!btn) return;
    flash(btn);
    handleKeyAction(btn.dataset.action, btn);
  });

  // Keyboard support
  const KEY_TO_OPERATOR = { "+": "+", "-": "−", "*": "×", "/": "÷" };

  document.addEventListener("keydown", (e) => {
    // Ignore keystrokes while typing into a text input elsewhere on the page.
    if (e.target.tagName === "INPUT") return;

    if (/^[0-9]$/.test(e.key)) {
      inputDigit(e.key);
      return;
    }
    if (e.key === ".") {
      inputDecimal();
      return;
    }
    if (KEY_TO_OPERATOR[e.key]) {
      inputOperator(KEY_TO_OPERATOR[e.key]);
      return;
    }
    if (e.key === "(" || e.key === ")") {
      inputParen(e.key);
      return;
    }
    if (e.key === "%") {
      applyPercent();
      return;
    }
    if (e.key === "Enter" || e.key === "=") {
      e.preventDefault();
      calculate();
      return;
    }
    if (e.key === "Backspace") {
      backspace();
      return;
    }
    if (e.key === "Escape") {
      resetCalc();
      return;
    }
  });

  render();

  /* ------------------------------------------------------------------ *
   * 5. History (localStorage)
   * ------------------------------------------------------------------ */

  const HISTORY_KEY = "smartcalc_history";
  const historyListInline = document.getElementById("historyListInline");
  const historyListFull = document.getElementById("historyListFull");
  const clearHistoryInline = document.getElementById("clearHistoryInline");
  const clearHistoryFull = document.getElementById("clearHistoryFull");

  function loadHistory() {
    try {
      const raw = localStorage.getItem(HISTORY_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      return [];
    }
  }

  function saveHistory(list) {
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(list));
    } catch (e) {
      /* storage full or unavailable — history just won't persist */
    }
  }

  function renderHistoryList(container, items, { limit } = {}) {
    container.innerHTML = "";
    const toShow = limit ? items.slice(0, limit) : items;

    if (!toShow.length) {
      const li = document.createElement("li");
      li.className = "history-empty";
      li.textContent = "No calculations yet.";
      container.appendChild(li);
      return;
    }

    toShow.forEach((item) => {
      const li = document.createElement("li");
      li.className = "history-item";

      const text = document.createElement("div");
      text.className = "history-item__text";
      text.tabIndex = 0;
      text.setAttribute("role", "button");
      text.setAttribute("aria-label", "Reuse this result: " + item.result);

      const expr = document.createElement("div");
      expr.className = "history-item__expr";
      expr.textContent = item.expr;

      const res = document.createElement("div");
      res.className = "history-item__result";
      res.textContent = "= " + item.result;

      text.appendChild(expr);
      text.appendChild(res);

      const del = document.createElement("button");
      del.className = "history-item__delete";
      del.type = "button";
      del.setAttribute("aria-label", "Delete this entry");
      del.textContent = "✕";
      del.addEventListener("click", () => deleteHistory(item.id));

      text.addEventListener("click", () => reuseHistory(item));

      li.appendChild(text);
      li.appendChild(del);
      container.appendChild(li);
    });
  }

  function renderHistory() {
    const items = loadHistory();
    renderHistoryList(historyListInline, items, { limit: 8 });
    renderHistoryList(historyListFull, items);
  }

  function addHistory(expr, result) {
    const items = loadHistory();
    items.unshift({ id: Date.now() + Math.random(), expr, result });
    saveHistory(items.slice(0, 200)); // cap history size
    renderHistory();
  }

  function deleteHistory(id) {
    const items = loadHistory().filter((item) => item.id !== id);
    saveHistory(items);
    renderHistory();
  }

  function clearHistory() {
    saveHistory([]);
    renderHistory();
  }

  function reuseHistory(item) {
    resetCalc();
    calc.current = item.result.replace(/,/g, "");
    calc.justEvaluated = true;
    render();
    showView("calculator");
  }

  clearHistoryInline.addEventListener("click", clearHistory);
  clearHistoryFull.addEventListener("click", clearHistory);

  renderHistory();

  /* ------------------------------------------------------------------ *
   * 6. Percentage tool
   * ------------------------------------------------------------------ */

  const pctForms = document.querySelectorAll(".tool-block[data-pct]");

  const PCT_FORMULAS = {
    of: (x, y) => (x / 100) * y,
    isWhatPercent: (x, y) => (y === 0 ? null : (x / y) * 100),
    increase: (x, y) => (x === 0 ? null : ((y - x) / x) * 100),
    decrease: (x, y) => (x === 0 ? null : ((x - y) / x) * 100),
  };

  const PCT_LABELS = {
    of: (x, y, r) => `${formatNumber(x)}% of ${formatNumber(y)} is ${formatNumber(r)}`,
    isWhatPercent: (x, y, r) => `${formatNumber(x)} is ${formatNumber(r)}% of ${formatNumber(y)}`,
    increase: (x, y, r) => `That is a ${formatNumber(r)}% increase`,
    decrease: (x, y, r) => `That is a ${formatNumber(r)}% decrease`,
  };

  pctForms.forEach((form) => {
    const kind = form.dataset.pct;
    const xInput = form.querySelector('[data-input="x"]');
    const yInput = form.querySelector('[data-input="y"]');
    const answer = form.querySelector("[data-answer]");

    function update() {
      const x = parseFloat(xInput.value);
      const y = parseFloat(yInput.value);
      if (Number.isNaN(x) || Number.isNaN(y)) {
        answer.textContent = "Enter both values to see the result";
        return;
      }
      const result = PCT_FORMULAS[kind](x, y);
      if (result === null || !Number.isFinite(result)) {
        answer.textContent = "Enter a non-zero value to compare against";
        return;
      }
      answer.textContent = PCT_LABELS[kind](x, y, result);
    }

    xInput.addEventListener("input", update);
    yInput.addEventListener("input", update);
    form.addEventListener("submit", (e) => e.preventDefault());
  });

  /* ------------------------------------------------------------------ *
   * 7. Discount tool
   * ------------------------------------------------------------------ */

  const discOriginal = document.getElementById("discOriginal");
  const discPercent = document.getElementById("discPercent");
  const discFinal = document.getElementById("discFinal");
  const discSaved = document.getElementById("discSaved");

  function updateDiscount() {
    const price = parseFloat(discOriginal.value);
    const pct = parseFloat(discPercent.value);

    if (Number.isNaN(price) || price < 0) {
      discFinal.textContent = "0.00";
      discSaved.textContent = "0.00";
      return;
    }
    const clampedPct = Number.isNaN(pct) ? 0 : Math.min(Math.max(pct, 0), 100);
    const saved = (price * clampedPct) / 100;
    const final = price - saved;

    discFinal.textContent = formatNumber(Math.round(final * 100) / 100);
    discSaved.textContent = formatNumber(Math.round(saved * 100) / 100);
  }

  discOriginal.addEventListener("input", updateDiscount);
  discPercent.addEventListener("input", updateDiscount);
  document.getElementById("discountForm").addEventListener("submit", (e) => e.preventDefault());

  updateDiscount();
})();
