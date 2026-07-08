import { useState } from "react";

function App() {
  const [device, setDevice] = useState(null);
  const [characteristic, setCharacteristic] = useState(null);

  const connectBluetooth = async () => {
    try {
      const bluetoothDevice = await navigator.bluetooth.requestDevice({
        filters: [
          { name: "Energy Meter" }
        ],
        optionalServices: [
          "5b6b5f91-89a6-4dc8-b6d0-8f2c7a001001"
        ]
      });

      const server = await bluetoothDevice.gatt.connect();
      const service = await server.getPrimaryService(
          "5b6b5f91-89a6-4dc8-b6d0-8f2c7a001001"
      );
      const characteristic = await service.getCharacteristic(
          "5b6b5f91-89a6-4dc8-b6d0-8f2c7a001002"
      );
      setDevice(bluetoothDevice);
      setCharacteristic(characteristic);
      alert("Connected!");
    } catch (err) {
      console.error(err);
    }
  };

  const sendCommand = async (command) => {
      if (!characteristic) {
          alert("먼저 Connect를 눌러주세요.");
          return;
      }

      try {
          const encoder = new TextEncoder();

          await characteristic.writeValue(
              encoder.encode(command)
          );

          console.log("Sent :", command);

      } catch (err) {
          console.error(err);
      }
  };

  return (
    <div>
      <h1>Energy Meter</h1>

      <button onClick={connectBluetooth}>
        Connect
      </button>

      <br /><br />

      <button onClick={() => sendCommand("START")}>
          START
      </button>

      <button onClick={() => sendCommand("LAP")}>
          LAP
      </button>

      <button onClick={() => sendCommand("STOP")}>
          STOP
      </button>
    </div>
  );
}

export default App;