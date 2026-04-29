import { Line } from "react-chartjs-2";
import {
  CategoryScale,
  Chart as ChartJS,
  Filler,
  LineElement,
  LinearScale,
  PointElement,
  Tooltip,
} from "chart.js";

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Filler);

export function MiniTrendChart({ labels = [], values = [], color = "#0c7db8", height = 76 }) {
  const safeValues = values.map((item) => Number(item || 0));
  const data = {
    labels,
    datasets: [
      {
        data: safeValues,
        borderColor: color,
        backgroundColor: `${color}22`,
        borderWidth: 2,
        pointRadius: 0,
        tension: 0.35,
        fill: true,
      },
    ],
  };
  const options = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { display: false }, tooltip: { intersect: false, mode: "index" } },
    scales: { x: { display: false }, y: { display: false } },
    elements: { line: { capBezierPoints: true } },
  };
  return (
    <div style={{ height }}>
      <Line data={data} options={options} />
    </div>
  );
}
