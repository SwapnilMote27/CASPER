import { BrowserRouter, Routes, Route } from "react-router-dom";
import Dashboard from "./pages/Dashboard";
import LiveEarth from "./pages/LiveEarth";
import SolarSystem from "./pages/SolarSystem";
import Satellites from "./pages/Satellites";
import Conjunctions from "./pages/Conjunctions";
import AIPrediction from "./pages/AiPrediction";
import Analytics from "./pages/Analytics";
import "./App.css";

function App() {
  return (
    <BrowserRouter>
      <Routes>

        <Route path="/" element={<Dashboard />} />
        <Route path="/live-earth" element={<LiveEarth />} />
        <Route path="/solar-system" element={<SolarSystem />} />
        <Route path="/satellites" element={<Satellites />} />
        <Route path="/conjunctions" element={<Conjunctions />} />
        <Route path="/ai-prediction" element={<AIPrediction />} />
        <Route path="/analytics" element={<Analytics />} />

      </Routes>
    </BrowserRouter>
  );
}

export default App;