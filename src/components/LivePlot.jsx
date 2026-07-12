import { useEffect, useRef } from "react";
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";

export default function LivePlot({ data }) {
  const containerRef = useRef(null);
  const plotRef = useRef(null);
  const resizeObserverRef = useRef(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const createChart = () => {
      if (plotRef.current) return;

      plotRef.current = new uPlot(
        {
          width: containerRef.current.clientWidth,
          height: 420,

          legend: {
            show: true,
          },

          scales: {
            x: {
              time: false,
            },
          },

          series: [
            {},

            {
              label: "HV",
              stroke: "#ef4444",
              width: 2,
            },

            {
              label: "Current",
              stroke: "#3b82f6",
              width: 2,
            },

            {
              label: "Power",
              stroke: "#a855f7",
              width: 2,
            },
          ],

          axes: [
            {
              stroke: "#777",
            },

            {
              stroke: "#777",
            },
          ],
        },

        data,

        containerRef.current
      );
    };

    createChart();

    resizeObserverRef.current = new ResizeObserver(() => {
      if (!plotRef.current || !containerRef.current) return;

      plotRef.current.setSize({
        width: containerRef.current.clientWidth,
        height: 420,
      });
    });

    resizeObserverRef.current.observe(containerRef.current);

    return () => {
      resizeObserverRef.current?.disconnect();
      plotRef.current?.destroy();
    };
  }, []);

  useEffect(() => {
    plotRef.current?.setData(data);
  }, [data]);

  return (
    <div
      ref={containerRef}
      style={{
        width: "100%",
        minHeight: "420px",
      }}
    />
  );
}