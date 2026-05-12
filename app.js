// ===== 設定 =====
let CONFIG = null;

async function loadConfig() {
  const res = await fetch("./config.json");
  if (!res.ok) {
    throw new Error(`config.json の読み込みに失敗しました: ${res.status}`);
  }
  CONFIG = await res.json();
}

function sensorConfig(type) {
  return CONFIG.sensors[type];
}

function sampleByteSize(type) {
  return CONFIG.sensors[type].sampleByteSize;
}

function plotCount(type) {
  return CONFIG.sensors[type].plotCount;
}

function distanceIrThreshold() {
  return CONFIG.sensors.MAX.distanceIrThreshold;
}

function requireAllDevices() {
  return CONFIG.app.requireAllDevices;
}

function maxDevicesPerSensor() {
  return CONFIG.app.maxDevicesPerSensor ?? 5;
}

function isMeasuring() {
  return measureAllBtn.textContent.includes("停止");
}

function activeDevices(type = null) {
  return Object.values(devices).filter(dev => !type || dev.type === type);
}

function applyAppConfig() {
  const appName = CONFIG.app.name || "VitSense";
  const version = CONFIG.app.version || "";

  document.title = `${appName} (${version})`;

  const titleEl = document.getElementById("app-title");
  if (titleEl) {
    titleEl.textContent = `${appName} (MAX/MLX 4台統合計測)`;
  }
}

// ===== デバイス管理 =====
const devices = {};
const deviceCounters = {
  MAX: 0,
  MLX: 0
};

const addButtons = {
  MAX: document.getElementById("add-max-device"),
  MLX: document.getElementById("add-mlx-device")
};

const deviceLists = {
  MAX: document.getElementById("max-device-list"),
  MLX: document.getElementById("mlx-device-list")
};

const countLabels = {
  MAX: document.getElementById("max-count"),
  MLX: document.getElementById("mlx-count")
};

// ===== グローバルUI =====
const measureAllBtn = document.getElementById("measure-all");
const downloadAllBtn = document.getElementById("download-all");

// ===== 初期化処理 (プルダウン生成) =====
function init() {
  applyAppConfig();

  addButtons.MAX.addEventListener("click", () => createDeviceBox("MAX"));
  addButtons.MLX.addEventListener("click", () => createDeviceBox("MLX"));

  updateUnifiedButtons();
}

function createDeviceBox(type) {
  if (activeDevices(type).length >= maxDevicesPerSensor()) {
    alert(`${type} デバイスは最大 ${maxDevicesPerSensor()} 台までです．`);
    return;
  }

  deviceCounters[type] += 1;

  const prefix = type.toLowerCase();
  const id = `${prefix}${deviceCounters[type]}`;
  const displayNo = activeDevices(type).length + 1;
  const cfg = sensorConfig(type);

  const box = document.createElement("div");
  box.className = "box";
  box.id = `${id}-box`;

  if (type === "MAX") {
    box.innerHTML = `
      <div class="box-header">
        <h3 id="${id}-title">MAX デバイス ${displayNo}</h3>
        <button id="${id}-close" class="close-device-btn">×</button>
      </div>
      <div class="controls">
        <select id="${id}-select" class="device-select"></select>
        <button id="${id}-connect">接続</button>
        <button id="${id}-disconnect" disabled>解除</button>
      </div>
      <div class="row">状態: <span id="${id}-status">未接続</span></div>
      <div class="row">名前: <span id="${id}-deviceName">-</span></div>
      <div class="row">時間: <span id="${id}-timeValue" class="val">-</span> s</div>
      <div class="row">距離: <span id="${id}-distanceStatus">-</span></div>
      <div class="device-chart-container">
        <canvas id="${id}-chart"></canvas>
      </div>
    `;
  } else {
    box.innerHTML = `
      <div class="box-header">
        <h3 id="${id}-title">MLX デバイス ${displayNo}</h3>
        <button id="${id}-close" class="close-device-btn">×</button>
      </div>
      <div class="controls">
        <select id="${id}-select" class="device-select"></select>
        <button id="${id}-connect">接続</button>
        <button id="${id}-disconnect" disabled>解除</button>
      </div>
      <div class="row">状態: <span id="${id}-status">未接続</span></div>
      <div class="row">名前: <span id="${id}-deviceName">-</span></div>
      <div class="row">Amb: <span id="${id}-ambValue" class="val">-</span> °C</div>
      <div class="row">Obj: <span id="${id}-objValue" class="val">-</span> °C</div>
      <div class="row">時間: <span id="${id}-timeValue" class="val">-</span> s</div>
      <div class="device-chart-container">
        <canvas id="${id}-chart"></canvas>
      </div>
    `;
  }

  deviceLists[type].appendChild(box);

  const dev = {
    id,
    type,
    name: "",
    serviceUUID: cfg.serviceUUID,
    charUUID: cfg.characteristicUUID,
    device: null,
    characteristic: null,
    measureStartEpochMs: null,
    data: [],
    buffer: new Uint8Array(),
    eventHandler: null,
    chart: null,
    ui: {
      box,
      title: document.getElementById(`${id}-title`),
      close: document.getElementById(`${id}-close`),
      select: document.getElementById(`${id}-select`),
      connect: document.getElementById(`${id}-connect`),
      disconnect: document.getElementById(`${id}-disconnect`),
      status: document.getElementById(`${id}-status`),
      deviceName: document.getElementById(`${id}-deviceName`),
      timeValue: document.getElementById(`${id}-timeValue`),
      distanceStatus: document.getElementById(`${id}-distanceStatus`),
      ambValue: document.getElementById(`${id}-ambValue`),
      objValue: document.getElementById(`${id}-objValue`),
      chartCanvas: document.getElementById(`${id}-chart`)
    }
  };

  cfg.deviceNames.forEach(name => {
    const opt = document.createElement("option");
    opt.value = name;
    opt.textContent = name;
    dev.ui.select.appendChild(opt);
  });

  devices[id] = dev;

  createDeviceChart(dev);

  dev.ui.connect.addEventListener("click", () => connectDevice(id));
  dev.ui.disconnect.addEventListener("click", () => disconnectDevice(id));
  dev.ui.close.addEventListener("click", () => removeDeviceBox(id));

  updateUnifiedButtons();
}

async function bootstrap() {
  try {
    await loadConfig();
    init();
  } catch (e) {
    console.error("config.json の読み込みに失敗しました:", e);
    alert("config.json の読み込みに失敗しました．ローカルサーバ経由で開いているか確認してください．");
  }
}

bootstrap();

// ===== ユーティリティ =====
function formatLocalTimeWithMs(epochMs) {
  const d = new Date(epochMs);
  const pad = (n, w=2) => String(n).padStart(w, "0");
  return `${d.getFullYear()}/${pad(d.getMonth()+1)}/${pad(d.getDate())} `
       + `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(),3)}`;
}

// ===== デバイス別チャート管理 =====
function createDeviceChart(dev) {
  const ctx = dev.ui.chartCanvas.getContext("2d");

  if (dev.type === "MAX") {
    dev.chart = new Chart(ctx, {
      type: "line",
      data: {
        datasets: [
          {
            label: "IR",
            data: [],
            yAxisID: "y-ir",
            borderColor: "rgba(75, 192, 192, 1)",
            borderWidth: 2,
            fill: false,
            pointRadius: 0,
            tension: 0.2
          },
          {
            label: "RED",
            data: [],
            yAxisID: "y-red",
            borderColor: "rgba(255, 99, 132, 1)",
            borderWidth: 2,
            fill: false,
            pointRadius: 0,
            tension: 0.2
          }
        ]
      },
      options: {
        responsive: true,
        animation: { duration: 0 },
        scales: {
          x: {
            type: "linear",
            title: { display: true, text: "経過時間 (s)" }
          },
          "y-ir": {
            type: "linear",
            position: "left",
            title: { display: true, text: "IR Value" }
          },
          "y-red": {
            type: "linear",
            position: "right",
            title: { display: true, text: "RED Value" },
            grid: { drawOnChartArea: false }
          }
        }
      }
    });
  } else {
    dev.chart = new Chart(ctx, {
      type: "line",
      data: {
        datasets: [
          {
            label: "Object (°C)",
            data: [],
            borderColor: "rgb(54, 162, 235)",
            borderWidth: 2,
            fill: false,
            pointRadius: 0,
            tension: 0.2
          }
        ]
      },
      options: {
        responsive: true,
        animation: { duration: 0 },
        scales: {
          x: {
            type: "linear",
            title: { display: true, text: "経過時間 (s)" }
          },
          y: {
            beginAtZero: false,
            title: { display: true, text: "Object 温度 (°C)" }
          }
        }
      }
    });
  }
}

function clearDeviceChart(dev) {
  if (!dev.chart) return;
  dev.chart.data.datasets.forEach(ds => {
    ds.data = [];
  });
  dev.chart.update("none");
}

async function removeDeviceBox(id) {
  const dev = devices[id];
  if (!dev) return;

  if (isMeasuring()) {
    alert("計測中はデバイスBoxを削除できません．計測停止後に削除してください．");
    return;
  }

  await disconnectDevice(id);

  if (dev.chart) {
    dev.chart.destroy();
    dev.chart = null;
  }

  if (dev.ui.box) {
    dev.ui.box.remove();
  }

  delete devices[id];
  updateUnifiedButtons();
}

// 共通チャート更新関数
function updateMaxChartData(id, elapsedS, ir, red) {
  const dev = devices[id];
  if (!dev || !dev.chart) return;

  const maxPts = plotCount("MAX");
  const irDataset = dev.chart.data.datasets[0];
  const redDataset = dev.chart.data.datasets[1];

  irDataset.data.push({ x: elapsedS, y: ir });
  redDataset.data.push({ x: elapsedS, y: red });

  if (irDataset.data.length > maxPts) {
    irDataset.data.shift();
    redDataset.data.shift();
  }

  dev.chart.update("none");
}

function updateMlxChartData(id, elapsedS, obj) {
  const dev = devices[id];
  if (!dev || !dev.chart) return;

  const maxPts = plotCount("MLX");
  const dataset = dev.chart.data.datasets[0];

  dataset.data.push({ x: elapsedS, y: obj });

  if (dataset.data.length > maxPts) {
    dataset.data.shift();
  }

  dev.chart.update("none");
}

function clearDeviceData(id) {
  const dev = devices[id];
  dev.data = [];
  dev.buffer = new Uint8Array();
  dev.measureStartEpochMs = null;
  
  dev.ui.timeValue.textContent = "-";
  if (dev.type === 'MAX') dev.ui.distanceStatus.textContent = "-";
  if (dev.type === 'MLX') {
    dev.ui.ambValue.textContent = "-";
    dev.ui.objValue.textContent = "-";
  }

  clearDeviceChart(dev);
}

function resetAllCharts() {
  Object.values(devices).forEach(dev => {
    clearDeviceChart(dev);
  });
}

// ===== 通知ハンドラ =====
function handleMaxNotification(event, id) {
  const dev = devices[id];
  if (dev.measureStartEpochMs === null) { dev.buffer = new Uint8Array(); return; }

  const byteSize = sampleByteSize('MAX');
  const newData = new Uint8Array(event.target.value.buffer);
  const combined = new Uint8Array(dev.buffer.length + newData.length);
  combined.set(dev.buffer);
  combined.set(newData, dev.buffer.length);
  dev.buffer = combined;

  while (dev.buffer.length >= byteSize) {
    const sampleView = new DataView(dev.buffer.buffer, 0, byteSize);
    const irValue = sampleView.getUint32(0, true);
    const redValue = sampleView.getUint32(4, true);
    const sensorElapsedMs = sampleView.getUint32(8, true);

    const recvEpochMs = Date.now();
    // 初回時刻同期は startMeasurementAll で行われるが、念のため
    if(!dev.measureStartEpochMs) dev.measureStartEpochMs = recvEpochMs;
    const measureElapsedS = (recvEpochMs - dev.measureStartEpochMs) / 1000;

    // 距離判定
    if (irValue < distanceIrThreshold()) {
      dev.ui.distanceStatus.textContent = "離れています";
      dev.ui.distanceStatus.style.color = "#d00";
    } else {
      dev.ui.distanceStatus.textContent = "正常";
      dev.ui.distanceStatus.style.color = "#046307";
    }

    // データ保存
    dev.data.push({
      irValue, redValue,
      sensor_elapsed_ms: sensorElapsedMs,
      recv_epoch_ms: recvEpochMs,
      recv_jst: formatLocalTimeWithMs(recvEpochMs),
      measure_elapsed_s: measureElapsedS
    });

    if (downloadAllBtn.disabled) updateUnifiedButtons();

    dev.ui.timeValue.textContent = measureElapsedS.toFixed(2);
    updateMaxChartData(id, measureElapsedS, irValue, redValue);

    dev.buffer = dev.buffer.slice(byteSize);
  }
}

function handleMlxNotification(event, id) {
  const dev = devices[id];
  if (dev.measureStartEpochMs === null) return;
  const v = event.target.value;
  if (v.byteLength !== sampleByteSize('MLX')) return;

  const recvEpochMs = Date.now();
  const amb = v.getFloat32(0, true);
  const obj = v.getFloat32(4, true);
  const rawAmbient = v.getInt16(8, true);
  const rawObject = v.getInt16(10, true);
  const sensorElapsedMs = v.getUint32(12, true);

  if(!dev.measureStartEpochMs) dev.measureStartEpochMs = recvEpochMs;
  const measureElapsedS = (recvEpochMs - dev.measureStartEpochMs) / 1000;
  const sensorElapsedS = sensorElapsedMs / 1000;

  dev.ui.ambValue.textContent = amb.toFixed(4);
  dev.ui.objValue.textContent = obj.toFixed(4);
  dev.ui.timeValue.textContent = measureElapsedS.toFixed(2);

  updateMlxChartData(id, measureElapsedS, obj);

  // データ保存 (measure_elapsed_sは保存しない)
  dev.data.push({
    amb, obj, rawAmbient, rawObject,
    sensor_elapsed_ms: sensorElapsedMs,
    measure_elapsed_s: measureElapsedS,
    recv_epoch_ms: recvEpochMs,
    recv_jst: formatLocalTimeWithMs(recvEpochMs)
  });
  if (downloadAllBtn.disabled) updateUnifiedButtons();
}

function updateDeviceChartTitle(dev) {
  if (!dev.chart) return;

  const labelName = dev.name || dev.id;

  if (dev.type === "MAX") {
    dev.chart.data.datasets[0].label = `IR (${labelName})`;
    dev.chart.data.datasets[1].label = `RED (${labelName})`;
  } else {
    dev.chart.data.datasets[0].label = `Object (${labelName})`;
  }

  dev.chart.update("none");
}

// ===== 接続・切断ロジック =====
async function connectDevice(id) {
  const dev = devices[id];
  const selectedName = dev.ui.select.value;
  
  if (!selectedName) {
    alert("デバイス名を選択してください");
    return;
  }

  try {
    dev.ui.status.textContent = "接続中...";
    const device = await navigator.bluetooth.requestDevice({
      filters: [{ name: selectedName }],
      optionalServices: [dev.serviceUUID]
    });
    
    dev.device = device;
    dev.name = selectedName; // 選択された名前を記憶
    
    const server = await device.gatt.connect();
    const service = await server.getPrimaryService(dev.serviceUUID);
    dev.characteristic = await service.getCharacteristic(dev.charUUID);

    // ハンドラ設定
    if (dev.type === 'MAX') {
      dev.eventHandler = (e) => handleMaxNotification(e, id);
    } else {
      dev.eventHandler = (e) => handleMlxNotification(e, id);
    }
    dev.characteristic.addEventListener('characteristicvaluechanged', dev.eventHandler);

    // UI更新
    dev.ui.status.textContent = "接続済み";
    dev.ui.deviceName.textContent = device.name;
    dev.ui.connect.disabled = true;
    dev.ui.select.disabled = true;
    dev.ui.disconnect.disabled = false;
    updateDeviceChartTitle(dev);

    // 切断時処理
    device.addEventListener('gattserverdisconnected', () => {
      dev.ui.status.textContent = "未接続";
      dev.ui.deviceName.textContent = "-";
      dev.ui.connect.disabled = false;
      dev.ui.select.disabled = false;
      dev.ui.disconnect.disabled = true;
      if(dev.eventHandler) {
         try{ dev.characteristic.removeEventListener('characteristicvaluechanged', dev.eventHandler); }catch{}
      }
      dev.buffer = new Uint8Array();
      dev.measureStartEpochMs = null;
      updateUnifiedButtons();
    });

  } catch (e) {
    console.error(e);
    alert(`${id} の接続に失敗しました`);
    dev.ui.status.textContent = "未接続";
  } finally {
    updateUnifiedButtons();
  }
}

async function disconnectDevice(id) {
  const dev = devices[id];
  if (dev.device && dev.device.gatt.connected) {
    if (dev.characteristic) {
      try { await dev.characteristic.stopNotifications(); } catch(e){}
    }
    dev.device.gatt.disconnect();
  }
}

// ボタンイベントリスナ登録
Object.keys(devices).forEach(id => {
  devices[id].ui.connect.addEventListener('click', () => connectDevice(id));
  devices[id].ui.disconnect.addEventListener('click', () => disconnectDevice(id));
});

// ===== 統合制御 (計測開始・停止) =====
function allConnected() {
  const active = Object.values(devices);
  if (active.length === 0) return false;

  const connectedDevices = active.filter(d => d.device && d.device.gatt.connected);

  if (requireAllDevices()) {
    return connectedDevices.length === active.length;
  }

  return connectedDevices.length > 0;
}

function updateUnifiedButtons() {
  const active = Object.values(devices);
  const allReady = allConnected();
  const measuring = isMeasuring();

  measureAllBtn.disabled = !allReady;

  const hasData = active.some(d => d.data.length > 0);
  downloadAllBtn.disabled = !hasData;

  const maxCount = activeDevices("MAX").length;
  const mlxCount = activeDevices("MLX").length;
  const limit = maxDevicesPerSensor();

  addButtons.MAX.disabled = measuring || maxCount >= limit;
  addButtons.MLX.disabled = measuring || mlxCount >= limit;

  countLabels.MAX.textContent = `${maxCount} / ${limit}`;
  countLabels.MLX.textContent = `${mlxCount} / ${limit}`;

  active.forEach(dev => {
    if (dev.ui.close) dev.ui.close.disabled = measuring;
    if (dev.ui.select && dev.device?.gatt?.connected) {
      dev.ui.select.disabled = true;
    }
  });
}

measureAllBtn.addEventListener('click', async () => {
  const isMeasuring = measureAllBtn.textContent.includes("停止");
  
  if (isMeasuring) {
    // 停止処理
    for (const id in devices) {
      const dev = devices[id];
      if (dev.characteristic) {
        try { await dev.characteristic.stopNotifications(); } catch(e){}
        dev.measureStartEpochMs = null;
      }
    }
    measureAllBtn.textContent = "計測開始";
    
  } else {
    // 開始処理
    if(!allConnected()) {
      alert("すべてのデバイスを接続してください");
      return;
    }
    
    resetAllCharts();
    const startTime = Date.now();
    
    for (const id in devices) {
      clearDeviceData(id); // データリセット
      const dev = devices[id];
      if (dev.characteristic) {
        await dev.characteristic.startNotifications();
        dev.measureStartEpochMs = startTime; 
      }
    }
    measureAllBtn.textContent = "計測停止";
  }
});

// ===== ダウンロード (CSV) =====
function formatTimestampForFilename(date = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}-${pad(date.getHours())}-${pad(date.getMinutes())}`;
}

function sanitizeFilename(name) {
  return String(name)
    .trim()
    .replace(/\s+/g, "_")
    .replace(/[\\/:*?"<>|]/g, "_");
}

function escapeCsvValue(value) {
  if (value === null || value === undefined) return "";
  const s = String(value);
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function rowsToCsv(rows, headers) {
  const headerLine = headers.join(",");
  const bodyLines = rows.map(row =>
    headers.map(header => escapeCsvValue(row[header])).join(",")
  );
  return [headerLine, ...bodyLines].join("\r\n");
}

function buildRows(data, type) {
  if (type === "MAX") {
    return data.map(r => ({
      IR_Value: r.irValue,
      RED_Value: r.redValue,
      SensorElapsed_ms: r.sensor_elapsed_ms,
      RecvEpoch_ms: r.recv_epoch_ms,
      RecvJST: r.recv_jst,
      MeasureElapsed_s: r.measure_elapsed_s
    }));
  }

  return data.map(r => ({
    Ambient_C: r.amb,
    Object_C: r.obj,
    Raw_Ambient: r.rawAmbient,
    Raw_Object: r.rawObject,
    SensorElapsed_ms: r.sensor_elapsed_ms,
    MeasureElapsed_s: r.measure_elapsed_s,
    RecvEpoch_ms: r.recv_epoch_ms,
    RecvJST: r.recv_jst
  }));
}

function csvHeaders(type) {
  if (type === "MAX") {
    return [
      "IR_Value",
      "RED_Value",
      "SensorElapsed_ms",
      "RecvEpoch_ms",
      "RecvJST",
      "MeasureElapsed_s"
    ];
  }

  return [
    "Ambient_C",
    "Object_C",
    "Raw_Ambient",
    "Raw_Object",
    "SensorElapsed_ms",
    "MeasureElapsed_s",
    "RecvEpoch_ms",
    "RecvJST"
  ];
}

function downloadCsv(deviceName, data, type, timestamp) {
  const rows = buildRows(data, type);
  const headers = csvHeaders(type);
  const csv = rowsToCsv(rows, headers);

  const bom = "\uFEFF";
  const blob = new Blob([bom + csv], { type: "text/csv;charset=utf-8;" });

  const safeName = sanitizeFilename(deviceName);
  const filename = `${safeName}_${timestamp}.csv`;

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

downloadAllBtn.addEventListener("click", () => {
  const timestamp = formatTimestampForFilename();

  Object.values(devices).forEach(dev => {
    const deviceName = dev.name || dev.id.toUpperCase();
    downloadCsv(deviceName, dev.data, dev.type, timestamp);
  });
});