import { useCallback, useEffect, useRef, useState } from "react";
import "./App.css";
import LivePlot from "./components/LivePlot";
import DataTile from "./components/DataTile";

const SERVICE_UUID = "5b6b5f91-89a6-4dc8-b6d0-8f2c7a001001";
const CHARACTERISTIC_UUID = "5b6b5f91-89a6-4dc8-b6d0-8f2c7a001002";

const COMMANDS = ["PING", "STATUS", "START", "STOP", "LAP"];

const initialStatus = {
  bridge: "대기",
  stm: "대기",
  mode: "UNKNOWN",
  ready: false,
  running: null,
  race: "-",
  lap: "-",
  uptime: "-",
  err: "-",
  latency: "-",
  lastRx: "-",
  lastRxAt: 0,
  boot: false,
  lastError: "",
};

const STARTUP_PROBE_COMMANDS = ["BRIDGE?", "PING", "STATUS"];
const STARTUP_PROBE_INTERVAL_MS = 350;
const STATUS_PAIR_KEYS = ["mode", "ready", "running", "race", "lap", "uptime", "err"];

function timeLabel(date = new Date()) {
  return date.toLocaleTimeString("ko-KR", { hour12: false });
}

function parsePairs(text) {
  return text.split(/\s+/).reduce((pairs, token) => {
    const pos = token.indexOf("=");
    if (pos > 0) {
      pairs[token.slice(0, pos)] = token.slice(pos + 1);
    }
    return pairs;
  }, {});
}

function hasPair(pairs, key) {
  return Object.prototype.hasOwnProperty.call(pairs, key);
}

function parseFlag(value, fallback) {
  if (value === "1") return true;
  if (value === "0") return false;
  return fallback;
}

function normalizeIncomingLine(line) {
  const clean = line.trim().replace(/^(RX|TX)\s+/i, "").trim();

  if (clean.startsWith("ESP32")) {
    return { source: "esp32", body: clean, raw: clean };
  }

  const stmIndex = clean.indexOf("STM ");
  if (stmIndex >= 0) {
    return { source: "stm", body: clean.slice(stmIndex + 4).trim(), raw: clean };
  }

  return { source: "unknown", body: clean, raw: clean };
}

function resolveMode(body, pairs, fallback) {
  if (pairs.mode) return pairs.mode;
  if (/\bRECORD\b/.test(body)) return "RECORD";
  if (/\bUSB\b/.test(body)) return "USB";
  return fallback;
}

function StatusTile({ label, value, tone, detail }) {
  return (
    <div className={`status-tile ${tone || ""}`}>
      <div className="status-label">{label}</div>
      <div className="status-value">{value}</div>
      {detail ? <div className="status-detail">{detail}</div> : null}
    </div>
  );
}

export default function App() {
  const [transport, setTransport] = useState("none");
  const [connected, setConnected] = useState(false);
  const [monitoring, setMonitoring] = useState(false);
  const [status, setStatus] = useState(initialStatus);
  const [logs, setLogs] = useState([]);
  const [plotData, setPlotData] = useState([
    [],
    [],
    [],
    [],
  ]);
  const [nowTick, setNowTick] = useState(Date.now);
  const [liveData, setLiveData] = useState({
    hv: "-",
    cur: "-",
    lv: "-",
    temp: "-"
  });

  const portRef = useRef(null);
  const readerRef = useRef(null);
  const writerRef = useRef(null);
  const deviceRef = useRef(null);
  const characteristicRef = useRef(null);
  const readLoopActiveRef = useRef(false);
  const textBufferRef = useRef("");
  const bleFlushTimerRef = useRef(0);
  const pingSentAtRef = useRef(0);
  const monitorTickRef = useRef(0);
  const connectedRef = useRef(false);

  const addLog = useCallback((direction, text, tone = "") => {
    setLogs((current) => [
      {
        id: `${Date.now()}-${Math.random()}`,
        at: timeLabel(),
        direction,
        text,
        tone,
      },
      ...current,
    ].slice(0, 180));
  }, []);

  const updateFromDeviceLine = useCallback(
    (line) => {
      const incoming = normalizeIncomingLine(line);
      if (!incoming.raw) return;

      const now = Date.now();
      const rxTime = timeLabel(new Date(now));
      const isError = incoming.raw.includes("ERR");
      addLog("RX", incoming.raw, isError ? "bad" : "");

      if (incoming.source === "esp32") {
        setStatus((current) => ({
          ...current,
          bridge: incoming.raw.includes("ERR") ? "오류" : "연결됨",
        }));
        return;
      }

      const body = incoming.body;
      const pairs = parsePairs(body);

      if (body.startsWith("DATA")) {

          const hv = Number(pairs.hv ?? 0);
          const cur = Number(pairs.cur ?? 0);

          setLiveData({
              hv: pairs.hv ?? "-",
              cur: pairs.cur ?? "-",
              lv: pairs.lv ?? "-",
              temp: pairs.temp ?? "-"
          });

          setPlotData((prev) => {

              const x=[...prev[0]];
              const hvData=[...prev[1]];
              const curData=[...prev[2]];
              const powerData=[...prev[3]];

              x.push(x.length);
              hvData.push(hv);
              curData.push(cur);
              powerData.push(hv*cur/1000);

              if(x.length>300){
                  x.shift();
                  hvData.shift();
                  curData.shift();
                  powerData.shift();
              }

              return [x,hvData,curData,powerData];

          });

          return;
      }

      if (body.startsWith("BOOT")) {
        setStatus((current) => ({
          ...current,
          stm: "응답",
          boot: true,
          mode: resolveMode(body, pairs, current.mode),
          lastRx: rxTime,
          lastRxAt: now,
        }));
        return;
      }

      if (body.startsWith("PONG") || body.startsWith("OK")) {
        const latency =
          pingSentAtRef.current > 0 ? `${Math.max(1, Math.round(performance.now() - pingSentAtRef.current))} ms` : "-";
        pingSentAtRef.current = 0;
        setStatus((current) => ({
          ...current,
          stm: "응답",
          latency,
          lastRx: rxTime,
          lastRxAt: now,
        }));
        return;
      }

      if (/^(STATUS|STARTED|STOPPED|LAP)\b/.test(body) || STATUS_PAIR_KEYS.some((key) => hasPair(pairs, key))) {
        const measuredLatency =
          pingSentAtRef.current > 0 ? `${Math.max(1, Math.round(performance.now() - pingSentAtRef.current))} ms` : "";
        pingSentAtRef.current = 0;

        setStatus((current) => ({
          ...current,
          stm: "응답",
          mode: resolveMode(body, pairs, current.mode),
          ready: parseFlag(pairs.ready, current.ready),
          running: parseFlag(pairs.running, current.running),
          race: hasPair(pairs, "race") ? pairs.race : current.race,
          lap: hasPair(pairs, "lap") ? pairs.lap : current.lap,
          uptime: hasPair(pairs, "uptime") ? `${pairs.uptime} ms` : current.uptime,
          err: hasPair(pairs, "err") ? pairs.err : current.err,
          latency: measuredLatency || current.latency,
          lastRx: rxTime,
          lastRxAt: now,
          lastError: "",
        }));
        return;
      }

      if (body.startsWith("ERR")) {
        setStatus((current) => ({
          ...current,
          stm: "응답",
          lastError: body,
          lastRx: rxTime,
          lastRxAt: now,
        }));
      }
    },
    [addLog],
  );

  const handleIncomingText = useCallback(
    (text) => {
      textBufferRef.current += text.replace(/\r/g, "\n");
      const parts = textBufferRef.current.split("\n");
      textBufferRef.current = parts.pop() || "";
      parts.forEach(updateFromDeviceLine);
    },
    [updateFromDeviceLine],
  );

  const readSerialLoop = useCallback(
    async (port) => {
      const decoder = new TextDecoder();
      readLoopActiveRef.current = true;

      while (readLoopActiveRef.current && port.readable) {
        const reader = port.readable.getReader();
        readerRef.current = reader;

        try {
          while (readLoopActiveRef.current) {
            const { value, done } = await reader.read();
            if (done) break;
            if (value) handleIncomingText(decoder.decode(value, { stream: true }));
          }
        } catch (error) {
          if (readLoopActiveRef.current) addLog("SYS", `Serial read stopped: ${error.message}`, "bad");
        } finally {
          reader.releaseLock();
          readerRef.current = null;
        }
      }
    },
    [addLog, handleIncomingText],
  );

  const setConnectedState = useCallback((value, nextTransport = "none") => {
    connectedRef.current = value;
    setConnected(value);
    setTransport(nextTransport);
  }, []);

  const disconnect = useCallback(async () => {
    setMonitoring(false);
    readLoopActiveRef.current = false;

    try {
      await readerRef.current?.cancel();
    } catch {
      // Ignore close races from the browser serial stack.
    }

    try {
      writerRef.current?.releaseLock();
    } catch {
      // Writer may already be released.
    }

    try {
      await portRef.current?.close();
    } catch {
      // Port may already be closed.
    }

    if (deviceRef.current?.gatt?.connected) {
      deviceRef.current.gatt.disconnect();
    }

    portRef.current = null;
    writerRef.current = null;
    deviceRef.current = null;
    characteristicRef.current = null;
    textBufferRef.current = "";
    window.clearTimeout(bleFlushTimerRef.current);
    bleFlushTimerRef.current = 0;
    setConnectedState(false);
    setStatus(initialStatus);
    addLog("SYS", "Disconnected");
  }, [addLog, setConnectedState]);

  const sendCommand = useCallback(
    async (command) => {
      if (!connectedRef.current) {
        addLog("SYS", "No bridge connection", "bad");
        return;
      }

      const line = `${command}\n`;
      const payload = new TextEncoder().encode(line);

      try {
        if (writerRef.current) {
          await writerRef.current.write(payload);
        } else if (characteristicRef.current) {
          if (typeof characteristicRef.current.writeValueWithResponse === "function") {
            await characteristicRef.current.writeValueWithResponse(payload);
          } else {
            await characteristicRef.current.writeValue(payload);
          }
        } else {
          throw new Error("No active transport");
        }

        if (command === "PING") {
          pingSentAtRef.current = performance.now();
        }

        addLog("TX", command);
      } catch (error) {
        addLog("SYS", `Send failed: ${error.message}`, "bad");
      }
    },
    [addLog],
  );

  const sendStartupProbe = useCallback(() => {
    STARTUP_PROBE_COMMANDS.forEach((command, index) => {
      window.setTimeout(() => {
        if (connectedRef.current) sendCommand(command);
      }, STARTUP_PROBE_INTERVAL_MS * (index + 1));
    });
  }, [sendCommand]);

  const connectSerial = useCallback(async () => {
    try {
      if (!("serial" in navigator)) throw new Error("Web Serial API is not available");

      const port = await navigator.serial.requestPort();
      await port.open({ baudRate: 115200 });

      portRef.current = port;
      writerRef.current = port.writable.getWriter();
      setConnectedState(true, "usb");
      setStatus((current) => ({ ...current, bridge: "USB 연결됨" }));
      addLog("SYS", "USB serial connected");
      readSerialLoop(port);
      sendStartupProbe();
    } catch (error) {
      addLog("SYS", `USB connect failed: ${error.message}`, "bad");
    }
  }, [addLog, readSerialLoop, sendStartupProbe, setConnectedState]);

  const connectBle = useCallback(async () => {
    try {
      if (!navigator.bluetooth) throw new Error("Web Bluetooth API is not available");

      const device = await navigator.bluetooth.requestDevice({
        filters: [{ name: "Energy Meter" }],
        optionalServices: [SERVICE_UUID],
      });

      device.addEventListener("gattserverdisconnected", () => {
        setConnectedState(false);
        setMonitoring(false);
        setStatus((current) => ({ ...current, bridge: "BLE 끊김" }));
        addLog("SYS", "BLE disconnected", "bad");
      });

      const server = await device.gatt.connect();
      const service = await server.getPrimaryService(SERVICE_UUID);
      const characteristic = await service.getCharacteristic(CHARACTERISTIC_UUID);

      try {
        await characteristic.startNotifications();
        characteristic.addEventListener("characteristicvaluechanged", (event) => {
          const text = new TextDecoder().decode(event.target.value);
          handleIncomingText(text);

          if (!text.includes("\n")) {
            window.clearTimeout(bleFlushTimerRef.current);
            bleFlushTimerRef.current = window.setTimeout(() => handleIncomingText("\n"), 120);
          }
        });
      } catch (error) {
        addLog("SYS", `BLE notifications unavailable: ${error.message}`, "bad");
      }

      deviceRef.current = device;
      characteristicRef.current = characteristic;
      setConnectedState(true, "ble");
      setStatus((current) => ({ ...current, bridge: "BLE 연결됨" }));
      addLog("SYS", "BLE connected");
      sendStartupProbe();
    } catch (error) {
      addLog("SYS", `BLE connect failed: ${error.message}`, "bad");
    }
  }, [addLog, handleIncomingText, sendStartupProbe, setConnectedState]);

  useEffect(() => {
    if (!monitoring || !connected) return undefined;

    const timer = window.setInterval(() => {
      const tick = monitorTickRef.current++;
      sendCommand(tick % 3 === 0 ? "STATUS" : "PING");
    }, 1500);

    return () => window.clearInterval(timer);
  }, [connected, monitoring, sendCommand]);

  useEffect(() => () => {
    readLoopActiveRef.current = false;
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setNowTick(Date.now()), 1000);

    return () => window.clearInterval(timer);
  }, []);

  const stmFresh = status.lastRxAt > 0 && nowTick - status.lastRxAt < 5000;
  const stmAgeSeconds = status.lastRxAt > 0 ? Math.max(0, Math.round((nowTick - status.lastRxAt) / 1000)) : null;
  const stmValue = status.lastRxAt > 0 ? (stmFresh ? "응답 중" : "최근 응답") : connected ? "확인 중" : status.stm;
  const stmTone = status.lastRxAt > 0 ? (stmFresh ? "good" : "idle") : "";
  const stmDetail = status.lastRxAt > 0 ? `${status.lastRx} / ${stmAgeSeconds}초 전` : status.lastRx;
  const modeValue = status.mode === "UNKNOWN" ? (connected ? "확인 중" : "-") : status.mode;
  const modeTone = status.mode === "RECORD" ? "good" : status.mode === "USB" ? "idle" : "";
  const runLabel = status.running === null ? "UNKNOWN" : status.running ? "RUNNING" : "STOPPED";
  const hv = Number(liveData.hv);
  const cur = Number(liveData.cur);
  const power =
    Number.isFinite(hv) && Number.isFinite(cur)
      ? (hv * cur / 1000).toFixed(2)
      : "-";

  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Energy Meter Bridge</p>
          <h1>STM32 Link Monitor</h1>
        </div>
        <div className="connection-actions">
          <button className="action-button" onClick={connectSerial} disabled={connected}>
            USB 연결
          </button>
          <button className="action-button secondary" onClick={connectBle} disabled={connected}>
            BLE 연결
          </button>
          <button className="icon-button danger" onClick={disconnect} disabled={!connected} aria-label="연결 해제">
            ⏻
          </button>
        </div>
      </header>

      <main className="dashboard">
        <section className="panel status-panel">
          <div className="panel-title">
            <h2>상태</h2>
            <span className={`transport-pill ${connected ? "on" : ""}`}>
              {connected ? (transport === "usb" ? "USB Serial" : "BLE") : "Disconnected"}
            </span>
          </div>

          <div className="status-grid">
            <StatusTile label="ESP32" value={status.bridge} tone={connected ? "good" : ""} />
            <StatusTile label="STM32 UART" value={stmValue} tone={stmTone} detail={stmDetail} />
            <StatusTile label="MODE" value={modeValue} tone={modeTone} />
            <StatusTile label="RACE" value={runLabel} tone={status.running ? "good" : status.running === false ? "idle" : ""} detail={`race ${status.race} / lap ${status.lap}`} />
            <StatusTile label="LATENCY" value={status.latency} />
            <StatusTile label="ERROR" value={status.err} tone={status.err !== "-" && status.err !== "0" ? "bad" : ""} detail={status.lastError} />
          </div>
        </section>
        <section className="panel command-panel">
          <div className="panel-title">
            <h2>제어</h2>
            <button className={`monitor-button ${monitoring ? "active" : ""}`} onClick={() => setMonitoring((value) => !value)} disabled={!connected}>
              {monitoring ? "모니터 정지" : "모니터 시작"}
            </button>
          </div>

          <div className="command-grid">
            {COMMANDS.map((command) => (
              <button key={command} className={`command-button ${command.toLowerCase()}`} onClick={() => sendCommand(command)} disabled={!connected}>
                {command}
              </button>
            ))}
          </div>
        </section>
        <section className="panel data-panel">
          <div className="panel-title">
            <h2>실시간 데이터</h2>
          </div>
          <div className="data-grid">
            <DataTile
              title="HV Voltage"
              value={liveData.hv}
              unit="V"
              accent="red"
            />
            <DataTile
              title="Current"
              value={liveData.cur}
              unit="A"
              accent="blue"
            />
            <DataTile
              title="Power"
              value={power}
              unit="kW"
              accent="purple"
            />
            <DataTile
              title="LV Voltage"
              value={liveData.lv}
              unit="V"
            />
            <DataTile
              title="Temperature"
              value={liveData.temp}
              unit="℃"
            />
            <DataTile
              title="Race"
              value={status.race}
            />
            <DataTile
              title="Lap"
              value={status.lap}
            />
            <DataTile
              title="Elapsed"
              value="00:00:00"
            />
          </div>
        </section>
        <section className="panel graph-panel">
            <div className="panel-title">
                <h2>Live Graph</h2>
            </div>
            <LivePlot data={plotData}/>
        </section>
        <section className="panel log-panel">
          <div className="panel-title">
            <h2>로그</h2>
            <button className="clear-button" onClick={() => setLogs([])} disabled={logs.length === 0}>
              지우기
            </button>
          </div>
          <div className="log-list">
            {logs.length === 0 ? (
              <div className="empty-log">연결 대기 중</div>
            ) : (
              logs.map((entry) => (
                <div key={entry.id} className={`log-row ${entry.direction.toLowerCase()} ${entry.tone}`}>
                  <span>{entry.at}</span>
                  <strong>{entry.direction}</strong>
                  <code>{entry.text}</code>
                </div>
              ))
            )}
          </div>
        </section>
      </main>
    </div>
  );
}
