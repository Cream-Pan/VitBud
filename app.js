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

function applySlotConfig() {
  Object.keys(devices).forEach(id => {
    const dev = devices[id];
    const slot = CONFIG.slots[id];
    if (!slot) return;

    if (dev.ui.title) {
      dev.ui.title.textContent = `${slot.label} (${slot.defaultRole})`;
    }

    if (dev.ui.select && slot.defaultRole) {
      dev.ui.select.value = slot.defaultRole;
    }
  });
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

// ===== デバイス管理オブジェクト (4台構成) =====
const devices = {
  // MAX 1
  "max1": {
    type: 'MAX',
    name: '',
    serviceUUID: null,
    charUUID: null,
    device: null, characteristic: null, measureStartEpochMs: null,
    data: [], buffer: new Uint8Array(), eventHandler: null,
    ui: {
      title: document.getElementById("max1-title"),
      select: document.getElementById("max1-select"),
      connect: document.getElementById("max1-connect"),
      disconnect: document.getElementById("max1-disconnect"),
      status: document.getElementById("max1-status"),
      deviceName: document.getElementById("max1-deviceName"),
      timeValue: document.getElementById("max1-timeValue"),
      distanceStatus: document.getElementById("max1-distanceStatus"),
    }
  },
  // MAX 2
  "max2": {
    type: 'MAX',
    name: '',
    serviceUUID: null,
    charUUID: null,
    device: null, characteristic: null, measureStartEpochMs: null,
    data: [], buffer: new Uint8Array(), eventHandler: null,
    ui: {
      title: document.getElementById("max2-title"),
      select: document.getElementById("max2-select"),
      connect: document.getElementById("max2-connect"),
      disconnect: document.getElementById("max2-disconnect"),
      status: document.getElementById("max2-status"),
      deviceName: document.getElementById("max2-deviceName"),
      timeValue: document.getElementById("max2-timeValue"),
      distanceStatus: document.getElementById("max2-distanceStatus"),
    }
  },
  // MLX 1
  "mlx1": {
    type: 'MLX',
    name: '',
    serviceUUID: null,
    charUUID: null,
    device: null, characteristic: null, measureStartEpochMs: null,
    data: [], buffer: new Uint8Array(), eventHandler: null,
    ui: {
      title: document.getElementById("mlx1-title"),
      select: document.getElementById("mlx1-select"),
      connect: document.getElementById("mlx1-connect"),
      disconnect: document.getElementById("mlx1-disconnect"),
      status: document.getElementById("mlx1-status"),
      deviceName: document.getElementById("mlx1-deviceName"),
      timeValue: document.getElementById("mlx1-timeValue"),
      ambValue: document.getElementById("mlx1-ambValue"),
      objValue: document.getElementById("mlx1-objValue"),
    }
  },
  // MLX 2
  "mlx2": {
    type: 'MLX',
    name: '',
    serviceUUID: null,
    charUUID: null,
    device: null, characteristic: null, measureStartEpochMs: null,
    data: [], buffer: new Uint8Array(), eventHandler: null,
    ui: {
      title: document.getElementById("mlx2-title"),
      select: document.getElementById("mlx2-select"),
      connect: document.getElementById("mlx2-connect"),
      disconnect: document.getElementById("mlx2-disconnect"),
      status: document.getElementById("mlx2-status"),
      deviceName: document.getElementById("mlx2-deviceName"),
      timeValue: document.getElementById("mlx2-timeValue"),
      ambValue: document.getElementById("mlx2-ambValue"),
      objValue: document.getElementById("mlx2-objValue"),
    }
  }
};

// ===== グローバルUI =====
const measureAllBtn = document.getElementById("measure-all");
const downloadAllBtn = document.getElementById("download-all");

// ===== 初期化処理 (プルダウン生成) =====
function init() {
  ['max1', 'max2', 'mlx1', 'mlx2'].forEach(id => {
    const dev = devices[id];
    const cfg = sensorConfig(dev.type);

    dev.serviceUUID = cfg.serviceUUID;
    dev.charUUID = cfg.characteristicUUID;
    dev.ui.select.innerHTML = "";
  });

  const maxNames = sensorConfig('MAX').deviceNames;
  ['max1', 'max2'].forEach(id => {
    maxNames.forEach(name => {
      const opt = document.createElement('option');
      opt.value = name;
      opt.textContent = name;
      devices[id].ui.select.appendChild(opt);
    });
  });

  const mlxNames = sensorConfig('MLX').deviceNames;
  ['mlx1', 'mlx2'].forEach(id => {
    mlxNames.forEach(name => {
      const opt = document.createElement('option');
      opt.value = name;
      opt.textContent = name;
      devices[id].ui.select.appendChild(opt);
    });
  });

  applySlotConfig();
  applyAppConfig();
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

// ===== チャート管理 =====
let maxChart = null;
let mlxChart = null;

function ensureCharts() {
  // MAXチャート (IR/RED × 2台分 = 4本)
  if (!maxChart) {
    const ctx = document.getElementById("max-realtimeChart").getContext("2d");
    maxChart = new Chart(ctx, {
      type: "line",
      data: {
        datasets: [
          // Device 1 (実線)
          { label: "IR (Dev1)", data: [], yAxisID: 'y-ir', borderColor: "rgba(75, 192, 192, 1)", borderWidth: 2, fill:false, pointRadius:0, tension:0.2 },
          { label: "RED (Dev1)", data: [], yAxisID: 'y-red', borderColor: "rgba(255, 99, 132, 1)", borderWidth: 2, fill:false, pointRadius:0, tension:0.2 },
          // Device 2 (点線)
          { label: "IR (Dev2)", data: [], yAxisID: 'y-ir', borderColor: "rgba(75, 192, 192, 0.6)", borderWidth: 2, borderDash: [5, 5], fill:false, pointRadius:0, tension:0.2 },
          { label: "RED (Dev2)", data: [], yAxisID: 'y-red', borderColor: "rgba(255, 99, 132, 0.6)", borderWidth: 2, borderDash: [5, 5], fill:false, pointRadius:0, tension:0.2 }
        ]
      },
      options: {
        responsive: true, animation: { duration: 0 },
        scales: {
          x: { type: 'linear', title: { display: true, text: '経過時間 (s)' } },
          'y-ir': { type: 'linear', position: 'left', title: { display: true, text: 'IR Value', color: 'rgb(75, 192, 192)' }, ticks: { color: 'rgb(75, 192, 192)' } },
          'y-red': { type: 'linear', position: 'right', title: { display: true, text: 'RED Value', color: 'rgb(255, 99, 132)' }, ticks: { color: 'rgb(255, 99, 132)' }, grid: { drawOnChartArea: false } }
        }
      }
    });
  }

  // MLXチャート (ObjectTemp × 2台分 = 2本)
  if (!mlxChart) {
    const ctx = document.getElementById("mlx-realtimeChart").getContext("2d");
    mlxChart = new Chart(ctx, {
      type: "line",
      data: {
        datasets: [
          { label: "Obj (Dev3)", data: [], borderColor: "rgb(54, 162, 235)", borderWidth: 2, fill:false, pointRadius:0, tension:0.2 },
          { label: "Obj (Dev4)", data: [], borderColor: "rgb(255, 99, 132)", borderWidth: 2, fill:false, pointRadius:0, tension:0.2 }
        ]
      },
      options: {
        responsive: true, animation: { duration: 0 },
        scales: {
          x: { type: "linear", title: { display: true, text: "経過時間 (s)" } },
          y: { beginAtZero: false, title: { display: true, text: "温度 (°C)" } }
        }
      }
    });
  }
}

// 共通チャート更新関数
function updateMaxChartData(id, elapsedS, ir, red) {
  if (!maxChart) ensureCharts();
  const ds = maxChart.data.datasets;
  const baseIdx = (id === 'max1') ? 0 : 2;
  const maxPts = plotCount('MAX');
  
  ds[baseIdx].data.push({ x: elapsedS, y: ir });
  ds[baseIdx + 1].data.push({ x: elapsedS, y: red });

  // データ数制限
  if (ds[baseIdx].data.length > maxPts) {
    ds[baseIdx].data.shift();
    ds[baseIdx + 1].data.shift();
  }
  maxChart.update('none');
}

function updateMlxChartData(id, elapsedS, obj) {
  if (!mlxChart) ensureCharts();
  const ds = mlxChart.data.datasets;
  const idx = (id === 'mlx1') ? 0 : 1;
  const maxPts = plotCount('MLX');
  
  ds[idx].data.push({ x: elapsedS, y: obj });

  if (ds[idx].data.length > maxPts) {
    ds[idx].data.shift();
  }
  mlxChart.update('none');
}

function clearDeviceData(id) {
  const dev = devices[id];
  dev.data = [];
  dev.buffer = new Uint8Array();
  dev.measureStartEpochMs = null;
  
  // UIリセット
  dev.ui.timeValue.textContent = "-";
  if (dev.type === 'MAX') dev.ui.distanceStatus.textContent = "-";
  if (dev.type === 'MLX') {
    dev.ui.ambValue.textContent = "-";
    dev.ui.objValue.textContent = "-";
  }

  // チャートクリア (計測開始時に全クリアするため、ここでは個別の消去はしない)
}

function resetAllCharts() {
  if (maxChart) { maxChart.data.datasets.forEach(d => d.data = []); maxChart.update(); }
  if (mlxChart) { mlxChart.data.datasets.forEach(d => d.data = []); mlxChart.update(); }
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
  const connectedDevices = Object.values(devices).filter(d => d.device && d.device.gatt.connected);
  if (requireAllDevices()) {
    return connectedDevices.length === Object.keys(devices).length;
  }
 
  return connectedDevices.length > 0;
}

function updateUnifiedButtons() {
  const allReady = allConnected();
  measureAllBtn.disabled = !allReady;
  
  // データが1つでもあればDL可能
  const hasData = Object.values(devices).some(d => d.data.length > 0);
  downloadAllBtn.disabled = !hasData;
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

// ===== ダウンロード (Excel) =====
function appendSheet(wb, name, data, type) {
  if (data.length === 0) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["データなし"]]), name);
    return;
  }
  
  let rows;
  if (type === 'MAX') {
    rows = data.map(r => ({
      IR_Value: r.irValue,
      RED_Value: r.redValue,
      SensorElapsed_ms: r.sensor_elapsed_ms,
      RecvEpoch_ms: r.recv_epoch_ms,
      RecvJST: r.recv_jst,
      MeasureElapsed_s: r.measure_elapsed_s
    }));
  } else {
    rows = data.map(r => ({
      Ambient_C: r.amb,
      Object_C: r.obj,
      Raw_Ambient: r.rawAmbient,
      Raw_Object: r.rawObject,
      SensorElapsed_ms: r.sensor_elapsed_ms,
      MeasureElapsed_s: r.measure_elapsed_s,
      // MeasureElapsed_s は削除
      RecvEpoch_ms: r.recv_epoch_ms,
      RecvJST: r.recv_jst
    }));
  }
  
  const ws = XLSX.utils.json_to_sheet(rows);
  XLSX.utils.book_append_sheet(wb, ws, name);
}

downloadAllBtn.addEventListener('click', () => {
  const wb = XLSX.utils.book_new();
  
  // シート名はデバイス名 or デフォルトIDを使用
  appendSheet(wb, devices['max1'].name || 'MAX1', devices['max1'].data, 'MAX');
  appendSheet(wb, devices['max2'].name || 'MAX2', devices['max2'].data, 'MAX');
  appendSheet(wb, devices['mlx1'].name || 'MLX1', devices['mlx1'].data, 'MLX');
  appendSheet(wb, devices['mlx2'].name || 'MLX2', devices['mlx2'].data, 'MLX');
  
  XLSX.writeFile(wb, "VitBud_4Dev_Measurement.xlsx");
});