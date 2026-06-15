(() => {
  "use strict";

  const storageKey = "stationery-return-system-v1";
  const sourceStorageKey = "stationery-return-source-v1";
  const sourceInfoKey = "stationery-return-source-info-v1";
  const state = loadState();
  let selectedPerson = null;
  let activeFilter = "all";

  const $ = (selector) => document.querySelector(selector);
  const personIcon = `
    <svg class="person-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M20 21a8 8 0 0 0-16 0"></path>
      <circle cx="12" cy="7" r="4"></circle>
    </svg>`;
  let loans = normalizeLoans(loadSourceLoans());
  let people = buildPeople();
  migrateWaivedState();

  function loadState() {
    try {
      return JSON.parse(localStorage.getItem(storageKey)) || { items: {}, cases: {} };
    } catch {
      return { items: {}, cases: {} };
    }
  }

  function loadSourceLoans() {
    try {
      const saved = JSON.parse(localStorage.getItem(sourceStorageKey));
      return Array.isArray(saved) ? saved : [];
    } catch {
      return [];
    }
  }

  function loanSignature(loan) {
    return [
      loan.category, loan.itemNo, loan.itemName, loan.quantity,
      loan.department, loan.borrower, loan.borrowedAt
    ].map((value) => String(value ?? "").trim()).join("\u001f");
  }

  function hashText(text) {
    let hash = 2166136261;
    for (let index = 0; index < text.length; index++) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
  }

  function normalizeLoans(sourceLoans) {
    const occurrences = new Map();
    return sourceLoans.map((loan) => {
      const signature = loanSignature(loan);
      const occurrence = (occurrences.get(signature) || 0) + 1;
      occurrences.set(signature, occurrence);
      return {
        ...loan,
        quantity: Number(loan.quantity) || 0,
        price: Number(loan.price) || 0,
        amount: Number(loan.amount) || 0,
        id: `loan-${hashText(signature)}-${occurrence}`
      };
    });
  }

  function migrateWaivedState() {
    let changed = false;
    Object.values(state.items).forEach((item) => {
      if (item.status === "waived") {
        item.status = "pending";
        item.processedQty = 0;
        item.processedDate = "";
        changed = true;
      }
    });
    if (changed) localStorage.setItem(storageKey, JSON.stringify(state));
  }

  function saveState(message) {
    localStorage.setItem(storageKey, JSON.stringify(state));
    renderStats();
    renderPeople();
    if (selectedPerson) renderDetail();
    if (message) showToast(message);
  }

  function buildPeople() {
    const map = new Map();
    loans.forEach((loan) => {
      const key = `${loan.borrower}||${loan.department}`;
      if (!map.has(key)) map.set(key, { key, name: loan.borrower, department: loan.department, loans: [] });
      map.get(key).loans.push(loan);
    });
    return [...map.values()].sort((a, b) => a.department.localeCompare(b.department, "zh-Hant") || a.name.localeCompare(b.name, "zh-Hant"));
  }

  function itemState(loan) {
    return state.items[loan.id] || { status: "pending", processedQty: 0, processedDate: "", note: "" };
  }

  function personSummary(person) {
    const total = person.loans.reduce((sum, loan) => sum + loan.quantity, 0);
    const processed = person.loans.reduce((sum, loan) => {
      const current = itemState(loan);
      return sum + (current.status === "pending" ? 0 : Number(current.processedQty || 0));
    }, 0);
    return { total, processed, complete: total > 0 && processed >= total };
  }

  function renderStats() {
    const allQuantity = loans.reduce((sum, loan) => sum + loan.quantity, 0);
    const returned = loans.reduce((sum, loan) => {
      const current = itemState(loan);
      return sum + (current.status === "returned" ? Number(current.processedQty || 0) : 0);
    }, 0);
    const processed = loans.reduce((sum, loan) => {
      const current = itemState(loan);
      return sum + (current.status === "pending" ? 0 : Number(current.processedQty || 0));
    }, 0);
    $("#loanCount").textContent = loans.length.toLocaleString();
    $("#personCount").textContent = people.length.toLocaleString();
    $("#returnedCount").textContent = returned.toLocaleString();
    $("#pendingCount").textContent = Math.max(0, allQuantity - processed).toLocaleString();
  }

  function renderPeople() {
    const query = $("#searchInput").value.trim().toLowerCase();
    const filtered = people.filter((person) => {
      const summary = personSummary(person);
      const matchesFilter = activeFilter === "all" || (activeFilter === "complete" ? summary.complete : !summary.complete);
      const haystack = [person.name, person.department, ...person.loans.map((loan) => loan.itemName)].join(" ").toLowerCase();
      return matchesFilter && haystack.includes(query);
    });

    $("#filteredCount").textContent = `${filtered.length} 人`;
    $("#peopleList").innerHTML = filtered.length ? filtered.map((person) => {
      const summary = personSummary(person);
      return `
        <button class="person-card ${selectedPerson?.key === person.key ? "active" : ""}" data-person="${escapeHtml(person.key)}">
          <span class="mini-avatar">${personIcon}</span>
          <span><strong>${escapeHtml(person.name)}</strong><small>${escapeHtml(person.department)} · ${person.loans.length} 筆</small></span>
          <span class="item-badge ${summary.complete ? "complete" : ""}">${summary.complete ? "✓" : summary.total - summary.processed}</span>
        </button>`;
    }).join("") : '<p class="empty-list">找不到符合條件的人員。</p>';
  }

  function selectPerson(key) {
    selectedPerson = people.find((person) => person.key === key) || null;
    $("#emptyState").hidden = Boolean(selectedPerson);
    $("#detailContent").hidden = !selectedPerson;
    renderPeople();
    renderDetail();
  }

  function renderDetail() {
    if (!selectedPerson) return;
    const person = selectedPerson;
    const summary = personSummary(person);
    const caseInfo = state.cases[person.key] || {};
    $("#avatar").innerHTML = personIcon;
    $("#personName").textContent = person.name;
    $("#personMeta").textContent = `${person.department} · ${person.loans.length} 筆借用紀錄 · 共 ${summary.total} 件`;
    $("#leaveDate").value = caseInfo.leaveDate || "";
    $("#handler").value = caseInfo.handler || "";
    $("#progressText").textContent = `已處理 ${summary.processed} / ${summary.total} 件`;
    $("#progressBar").style.width = `${summary.total ? Math.min(100, summary.processed / summary.total * 100) : 0}%`;
    $("#caseStatus").textContent = summary.complete ? "已完成歸還核對" : "尚未結案";
    $("#caseStatus").className = summary.complete ? "complete" : "";
    $("#itemRows").innerHTML = person.loans
      .sort((a, b) => b.borrowedAt.localeCompare(a.borrowedAt))
      .map((loan) => renderLoanRow(loan))
      .join("");
  }

  function renderLoanRow(loan) {
    const current = itemState(loan);
    return `
      <tr data-loan="${loan.id}">
        <td><strong>${escapeHtml(loan.itemName)}</strong><small>${escapeHtml(loan.category)}${loan.itemNo ? ` · ${escapeHtml(loan.itemNo)}` : ""}</small></td>
        <td>${escapeHtml(loan.borrowedAt.slice(0, 10))}</td>
        <td>${loan.quantity}</td>
        <td>
          <select class="status-select ${statusClass(current.status)}" aria-label="${escapeHtml(loan.itemName)}處理狀態">
            <option value="pending" ${current.status === "pending" ? "selected" : ""}>待處理</option>
            <option value="returned" ${current.status === "returned" ? "selected" : ""}>已歸還</option>
            <option value="lost" ${current.status === "lost" ? "selected" : ""}>遺失</option>
          </select>
        </td>
        <td><input class="quantity-input" type="number" min="0" max="${loan.quantity}" value="${current.processedQty}" aria-label="${escapeHtml(loan.itemName)}本次處理數量"></td>
        <td><input class="date-input" type="date" value="${current.processedDate || ""}" aria-label="${escapeHtml(loan.itemName)}實際歸還日"></td>
        <td><input class="note-input" type="text" value="${escapeHtml(current.note)}" placeholder="選填" aria-label="${escapeHtml(loan.itemName)}備註"></td>
      </tr>`;
  }

  function updateLoan(row) {
    const id = row.dataset.loan;
    const loan = loans.find((item) => item.id === id);
    const status = row.querySelector(".status-select").value;
    const qtyInput = row.querySelector(".quantity-input");
    let processedQty = Math.max(0, Math.min(loan.quantity, Number(qtyInput.value) || 0));
    if (status !== "pending" && processedQty === 0) processedQty = loan.quantity;
    if (status === "pending") processedQty = 0;
    const dateInput = row.querySelector(".date-input");
    if (status !== "pending" && !dateInput.value) dateInput.value = today();
    if (status === "pending") dateInput.value = "";
    state.items[id] = {
      status,
      processedQty,
      processedDate: dateInput.value,
      note: row.querySelector(".note-input").value.trim()
    };
    saveState();
  }

  function saveCaseFields() {
    if (!selectedPerson) return;
    state.cases[selectedPerson.key] = {
      leaveDate: $("#leaveDate").value,
      handler: $("#handler").value.trim()
    };
    localStorage.setItem(storageKey, JSON.stringify(state));
  }

  function returnAll() {
    if (!selectedPerson) return;
    selectedPerson.loans.forEach((loan) => {
      const current = itemState(loan);
      state.items[loan.id] = {
        ...current,
        status: "returned",
        processedQty: loan.quantity,
        processedDate: current.processedDate || today()
      };
    });
    saveCaseFields();
    saveState("已將此同仁全部借用品標記為已歸還。");
  }

  function resetPerson() {
    if (!selectedPerson || !confirm(`確定清除 ${selectedPerson.name} 的歸還進度？`)) return;
    selectedPerson.loans.forEach((loan) => delete state.items[loan.id]);
    delete state.cases[selectedPerson.key];
    saveState("本案進度已清除。");
  }

  function exportCsv() {
    const rows = [["請領人", "部門", "物品類別", "物品編號", "物品名稱", "原借用數量", "處理狀態", "處理數量", "請領時間", "實際歸還日", "離職日", "經辦人", "備註"]];
    people.forEach((person) => {
      const caseInfo = state.cases[person.key] || {};
      person.loans.forEach((loan) => {
        const current = itemState(loan);
        rows.push([
          person.name, person.department, loan.category, loan.itemNo, loan.itemName,
          loan.quantity, statusLabel(current.status), current.processedQty || 0,
          loan.borrowedAt, current.processedDate || "", caseInfo.leaveDate || "",
          caseInfo.handler || "", current.note || ""
        ]);
      });
    });
    const csv = "\ufeff" + rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
    downloadBlob(csv, `文具歸還紀錄_${today()}.csv`, "text/csv;charset=utf-8");
    showToast("歸還紀錄已匯出。");
  }

  function backup() {
    const payload = JSON.stringify({
      version: 2,
      exportedAt: new Date().toISOString(),
      state,
      loans,
      sourceInfo: loadSourceInfo()
    }, null, 2);
    downloadBlob(payload, `文具歸還進度備份_${today()}.json`, "application/json");
    showToast("進度備份已下載。");
  }

  async function restore(file) {
    try {
      const payload = JSON.parse(await file.text());
      if (!payload.state?.items || !payload.state?.cases) throw new Error("格式不符");
      state.items = payload.state.items;
      state.cases = payload.state.cases;
      if (Array.isArray(payload.loans) && payload.loans.length) {
        loans = normalizeLoans(payload.loans);
        people = buildPeople();
        localStorage.setItem(sourceStorageKey, JSON.stringify(loans));
      }
      if (payload.sourceInfo) localStorage.setItem(sourceInfoKey, JSON.stringify(payload.sourceInfo));
      selectedPerson = null;
      $("#emptyState").hidden = false;
      $("#detailContent").hidden = true;
      renderSourceInfo();
      saveState("進度已成功還原。");
    } catch {
      alert("無法還原：檔案格式不正確。");
    }
  }

  function downloadBlob(content, filename, type) {
    const url = URL.createObjectURL(new Blob([content], { type }));
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 500);
  }

  function csvCell(value) {
    return `"${String(value ?? "").replaceAll('"', '""')}"`;
  }

  function statusClass(status) {
    if (status === "returned") return "status-returned";
    if (status === "lost") return "status-lost";
    return "";
  }

  function statusLabel(status) {
    return ({ pending: "待處理", returned: "已歸還", lost: "遺失" })[status] || "待處理";
  }

  function today() {
    return new Date().toLocaleDateString("sv-SE");
  }

  function parseCsv(text) {
    const rows = [];
    let row = [];
    let field = "";
    let quoted = false;
    const input = text.replace(/^\uFEFF/, "");

    for (let index = 0; index < input.length; index++) {
      const char = input[index];
      if (quoted) {
        if (char === '"' && input[index + 1] === '"') {
          field += '"';
          index++;
        } else if (char === '"') {
          quoted = false;
        } else {
          field += char;
        }
      } else if (char === '"') {
        quoted = true;
      } else if (char === ",") {
        row.push(field);
        field = "";
      } else if (char === "\n") {
        row.push(field.replace(/\r$/, ""));
        if (row.some((value) => value !== "")) rows.push(row);
        row = [];
        field = "";
      } else {
        field += char;
      }
    }
    row.push(field.replace(/\r$/, ""));
    if (row.some((value) => value !== "")) rows.push(row);
    return rows;
  }

  function csvToLoans(text) {
    const rows = parseCsv(text);
    if (rows.length < 2) throw new Error("CSV 沒有資料");
    const headers = rows[0].map((header) => header.trim());
    const required = ["物品類別", "物品名稱", "請領數量", "請領者部門名稱", "請領人", "請領時間", "狀態"];
    if (required.some((header) => !headers.includes(header))) throw new Error("CSV 欄位格式不符");
    const value = (row, header) => row[headers.indexOf(header)] ?? "";
    const allowed = new Set(["09-借用類", "10-借用類二手品$0元", "10-借用類(二手品$0元)"]);

    return rows.slice(1)
      .filter((row) => allowed.has(value(row, "物品類別").trim()) && value(row, "狀態").trim() === "已完成")
      .map((row) => ({
        category: value(row, "物品類別").trim(),
        itemNo: value(row, "物品編號").trim(),
        itemName: value(row, "物品名稱").trim(),
        quantity: Number(value(row, "請領數量")) || 0,
        price: Number(value(row, "價格")) || 0,
        amount: Number(value(row, "請領金額")) || 0,
        department: value(row, "請領者部門名稱").trim(),
        borrower: value(row, "請領人").trim(),
        borrowedAt: value(row, "請領時間").trim(),
        note: value(row, "說明").trim(),
        sourceStatus: value(row, "狀態").trim()
      }));
  }

  async function importSource(file) {
    try {
      const imported = normalizeLoans(csvToLoans(await file.text()));
      if (!imported.length) throw new Error("找不到符合條件的已完成借用資料");
      const previousIds = new Set(loans.map((loan) => loan.id));
      const added = imported.filter((loan) => !previousIds.has(loan.id)).length;
      loans = imported;
      people = buildPeople();
      selectedPerson = null;
      localStorage.setItem(sourceStorageKey, JSON.stringify(loans));
      localStorage.setItem(sourceInfoKey, JSON.stringify({
        fileName: file.name,
        updatedAt: new Date().toISOString()
      }));
      $("#emptyState").hidden = false;
      $("#detailContent").hidden = true;
      renderSourceInfo();
      renderStats();
      renderPeople();
      showToast(`原始資料已更新：共 ${loans.length} 筆，新增 ${added} 筆；既有歸還紀錄已保留。`);
    } catch (error) {
      alert(`無法匯入原始資料：${error.message}`);
    }
  }

  function loadSourceInfo() {
    try {
      return JSON.parse(localStorage.getItem(sourceInfoKey)) || null;
    } catch {
      return null;
    }
  }

  function renderSourceInfo() {
    const info = loadSourceInfo();
    $("#sourceFileName").textContent = info?.fileName || "尚未載入資料";
    $("#sourceUpdatedAt").textContent = info?.updatedAt
      ? `最後更新：${new Date(info.updatedAt).toLocaleString("zh-TW")}`
      : "請先上傳最新 CSV";
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  let toastTimer;
  function showToast(message) {
    const toast = $("#toast");
    toast.textContent = message;
    toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("show"), 2300);
  }

  $("#searchInput").addEventListener("input", renderPeople);
  $(".filter-row").addEventListener("click", (event) => {
    const chip = event.target.closest(".chip");
    if (!chip) return;
    activeFilter = chip.dataset.filter;
    document.querySelectorAll(".chip").forEach((item) => item.classList.toggle("active", item === chip));
    renderPeople();
  });
  $("#peopleList").addEventListener("click", (event) => {
    const card = event.target.closest(".person-card");
    if (card) selectPerson(card.dataset.person);
  });
  $("#itemRows").addEventListener("change", (event) => {
    const row = event.target.closest("tr");
    if (row) updateLoan(row);
  });
  $("#leaveDate").addEventListener("change", saveCaseFields);
  $("#handler").addEventListener("change", saveCaseFields);
  $("#returnAllBtn").addEventListener("click", returnAll);
  $("#resetPersonBtn").addEventListener("click", resetPerson);
  $("#printBtn").addEventListener("click", () => { saveCaseFields(); window.print(); });
  $("#exportBtn").addEventListener("click", exportCsv);
  $("#backupBtn").addEventListener("click", backup);
  $("#restoreInput").addEventListener("change", (event) => {
    if (event.target.files[0]) restore(event.target.files[0]);
    event.target.value = "";
  });
  $("#sourceInput").addEventListener("change", (event) => {
    if (event.target.files[0]) importSource(event.target.files[0]);
    event.target.value = "";
  });

  renderSourceInfo();
  renderStats();
  renderPeople();
})();
