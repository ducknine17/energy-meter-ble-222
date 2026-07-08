import { useState } from "react";

const [device, setDevice] = useState(null);
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

        setDevice(bluetoothDevice);

        alert("Connected!");
    }
    catch (err)
    {
        console.error(err);
    }
};

function App() {
  return (
    <div>
      <h1>Energy Meter</h1>

      <button onClick={connectBluetooth}>
          Connect
      </button>

      <br /><br />

      <button>START</button>
      <button>LAP</button>
      <button>STOP</button>
    </div>
  );
}

export default App;