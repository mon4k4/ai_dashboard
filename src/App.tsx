import { Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout';
import Kanban from './pages/Kanban';
import Scheduler from './pages/Scheduler';
import Minutes from './pages/Minutes';
import Report from './pages/Report';
import Settings from './pages/Settings';
import Projects from './pages/Projects';
import Members from './pages/Members';

function App() {
  return (
    <Routes>
      <Route path="/" element={<Layout />}>
        <Route index element={<Navigate to="/kanban" replace />} />
        <Route path="kanban" element={<Kanban />} />
        <Route path="scheduler" element={<Scheduler />} />
        <Route path="minutes" element={<Minutes />} />
        <Route path="report" element={<Report />} />
        <Route path="projects" element={<Projects />} />
        <Route path="members" element={<Members />} />
        <Route path="settings" element={<Settings />} />
      </Route>
    </Routes>
  );
}

export default App;
