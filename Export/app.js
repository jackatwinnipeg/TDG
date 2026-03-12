(function () {
  const DEFAULT_ROWS = 28; // PDF里主表格很多空行，这里默认生成 28 行

  function qs(sel, root = document) {
    return root.querySelector(sel);
  }
  function qsa(sel, root = document) {
    return Array.from(root.querySelectorAll(sel));
  }

  function setTextByKey(root, key, value) {
    const el = root.querySelector(`[data-key="${cssEscape(key)}"]`);
    if (!el) return false;
    el.textContent = value == null ? "" : String(value);
    return true;
  }

  function setCheckByKey(root, key, checked) {
    const box = root.querySelector(`[data-check="${cssEscape(key)}"]`);
    if (!box) return false;
    box.dataset.checked = checked ? "true" : "false";
    return true;
  }

  function cssEscape(s) {
    // minimal escape for attribute selectors
    return String(s).replace(/"/g, '\\"');
  }

  function buildRow(index) {
    const tr = document.createElement("tr");

    const cols = [
      { k: "customerLocation", editable: true },
      { k: "accountNumber", editable: true },
      { k: "size", editable: true },
      { k: "pressureStart", editable: true },
      { k: "pressureFin", editable: true },
      { k: "tankStart", editable: true },
      { k: "tankFin", editable: true },
      { k: "startValue", editable: true },
      { k: "finValue", editable: true },
      { k: "delivered", editable: true },
      { k: "balance", editable: true },
      { k: "arrive", editable: true },
    ];

    cols.forEach((c) => {
      const td = document.createElement("td");
      const div = document.createElement("div");
      div.className = "cell";
      div.contentEditable = c.editable ? "true" : "false";
      div.dataset.row = String(index);
      div.dataset.col = c.k;
      td.appendChild(div);
      tr.appendChild(td);
    });

    return tr;
  }

  function ensureRows(tbody, count) {
    const existing = tbody.children.length;
    for (let i = existing; i < count; i++) {
      tbody.appendChild(buildRow(i));
    }
    while (tbody.children.length > count) {
      tbody.removeChild(tbody.lastElementChild);
    }
  }

  function clearAll(root) {
    qsa("[data-key]", root).forEach((el) => (el.textContent = ""));
    qsa("[data-check]", root).forEach((el) => (el.dataset.checked = "false"));
    qsa(".cell", root).forEach((el) => (el.textContent = ""));
  }

  function fill(root, data) {
    if (!data || typeof data !== "object") return;

    // 1) 顶部/底部字段
    if (data.fields && typeof data.fields === "object") {
      Object.entries(data.fields).forEach(([k, v]) => setTextByKey(root, k, v));
    } else {
      // 允许扁平结构：直接 data.key
      Object.entries(data).forEach(([k, v]) => {
        if (k === "checks" || k === "rows" || k === "fields") return;
        setTextByKey(root, k, v);
      });
    }

    // 2) 复选框
    const checks = data.checks || {};
    if (checks && typeof checks === "object") {
      Object.entries(checks).forEach(([k, v]) => setCheckByKey(root, k, !!v));
    }

    // 3) 表格行
    const tbody = qs("#tdgBody", root);
    const rows = Array.isArray(data.rows) ? data.rows : [];
    const targetCount = Math.max(DEFAULT_ROWS, rows.length || DEFAULT_ROWS);
    ensureRows(tbody, targetCount);

    rows.forEach((row, i) => {
      if (!row || typeof row !== "object") return;
      Object.entries(row).forEach(([k, v]) => {
        const cell = tbody.querySelector(`.cell[data-row="${i}"][data-col="${cssEscape(k)}"]`);
        if (cell) cell.textContent = v == null ? "" : String(v);
      });
    });
  }

  function read(root) {
    const out = { fields: {}, checks: {}, rows: [] };

    qsa("[data-key]", root).forEach((el) => {
      out.fields[el.dataset.key] = el.textContent.trim();
    });

    qsa("[data-check]", root).forEach((el) => {
      out.checks[el.dataset.check] = el.dataset.checked === "true";
    });

    const tbody = qs("#tdgBody", root);
    const rowCount = tbody.children.length;

    for (let i = 0; i < rowCount; i++) {
      const rowObj = {};
      qsa(`.cell[data-row="${i}"]`, tbody).forEach((cell) => {
        rowObj[cell.dataset.col] = cell.textContent.trim();
      });

      // 如果整行都是空的，可以选择跳过；这里保留空行但可改逻辑
      out.rows.push(rowObj);
    }

    return out;
  }

  // 让复选框可点击切换（更像纸质勾选）
  function enableCheckboxToggle(root) {
    root.addEventListener("click", (e) => {
      const box = e.target && e.target.closest && e.target.closest("[data-check]");
      if (!box) return;
      const now = box.dataset.checked === "true";
      box.dataset.checked = now ? "false" : "true";
    });
  }

  // 暴露全局 API：window.TDGForm.fill(data)
  const root = qs("#tdgForm");
  const tbody = qs("#tdgBody", root);
  ensureRows(tbody, DEFAULT_ROWS);
  enableCheckboxToggle(root);

  window.TDGForm = {
    fill: (data) => fill(root, data),
    clear: () => clearAll(root),
    read: () => read(root),
    setRows: (n) => ensureRows(tbody, Math.max(1, Number(n) || DEFAULT_ROWS)),
  };

  // Demo buttons
  qs("#btnDemo").addEventListener("click", () => {
    window.TDGForm.fill({
      fields: {
        consignorName: "Linde Canada Inc.",
        erapPhone: "800-363-0042",
        pageNo: "1",
        pageTotal: "1",
        tdgStart: "07:00",
        volume: "12.5",
        shiftTime: "Day",
        shiftStart: "07:00",
        shiftFinish: "15:00",
        date: "2025-09-10",
        vehicleNo: "TRK-102",
        startKm: "120340",
        endKm: "120612",
        totalKm: "272",
        consignorPrintName: "John Doe",
      },
      checks: {
        checkLoaded: true,
        unitKG: true,
        unitM3: false,
        productOxygen: true,
        productNitrogen: false,
        productArgon: false,
        productCO2: false,
      },
      rows: [
        {
          customerLocation: "Customer A / Site 1",
          accountNumber: "A-001",
          size: "2.5",
          pressureStart: "110",
          pressureFin: "98",
          tankStart: "65%",
          tankFin: "80%",
          startValue: "1000",
          finValue: "1200",
          delivered: "200",
          balance: "0",
          arrive: "08:10",
        },
        {
          customerLocation: "Customer B / Site 2",
          accountNumber: "B-018",
          size: "1.0",
          pressureStart: "95",
          pressureFin: "90",
          tankStart: "40%",
          tankFin: "55%",
          startValue: "800",
          finValue: "920",
          delivered: "120",
          balance: "0",
          arrive: "10:35",
        },
      ],
    });
  });

  qs("#btnClear").addEventListener("click", () => window.TDGForm.clear());

})();